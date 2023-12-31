import OmeggaPlugin, {
  OL,
  PS,
  PC,
  WriteSaveObject,
  Vector,
  OmeggaPlayer,
} from 'omegga';
import Particle, { ParticleSystem } from './particle';
import { CategoryDef, ParticleDef, ParticleFile, computeRange } from './format';
import fs from 'fs';

const { random: uuid } = OMEGGA_UTIL.uuid;
const { code, cyan, yellow } = OMEGGA_UTIL.chat;

export type Config = { update_rate: number; authorized: string[] };

type Storage = {
  uuids: string[];
  emitters: { position: Vector; name: string; categories: string[] }[];
};

function loadParticleFile(filename: string): ParticleFile {
  const data = JSON.parse(fs.readFileSync(filename).toString()) as ParticleFile;

  function resolveRefs(def: ParticleDef) {
    if (!def.children) return;

    for (const child of def.children) {
      if (Array.isArray(child.def)) {
        child.def = child.def.map((d) => {
          const result = typeof d === 'string' ? data.defs[d] : d;
          if (!result) throw 'invalid_def_ref';
          resolveRefs(result);
          return result;
        });
      } else {
        if (typeof child.def === 'string') {
          child.def = data.defs[child.def];
          if (!child.def) throw 'invalid_def_ref';
        }
        resolveRefs(child.def);
      }
    }
  }

  for (const def of Object.values(data.defs)) {
    resolveRefs(def);
  }

  return data;
}

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  allUuids: string[] = [];
  freeUuids: string[] = [];
  lastUuid?: string;

  system: ParticleSystem;
  emitters: Storage['emitters'];
  showActive: boolean = false;
  abortShow?: () => void;

  data: ParticleFile;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;

    this.system = new ParticleSystem(config);
  }

  isAuthorized = (player: string | OmeggaPlayer): boolean => {
    const p =
      typeof player === 'string' ? this.omegga.getPlayer(player) : player;

    return (
      p.isHost() || p.getRoles().some((r) => this.config.authorized.includes(r))
    );
  };

  takeUuid = (): string => {
    if (this.freeUuids.length) {
      return this.freeUuids.pop();
    }

    const id = uuid();
    this.allUuids.push(id);
    this.store.set('uuids', this.allUuids);
    return id;
  };

  freeUuid = (id: string) => {
    this.freeUuids.push(id);
  };

  generateSave = (): [WriteSaveObject, string] => {
    const id = this.takeUuid();
    const save: WriteSaveObject = {
      brick_assets: ['PB_DefaultMicroBrick'],
      materials: ['BMC_Glow'],
      brick_owners: [{ name: 'Firework', id }],
      bricks: [],
    };

    let cur = this.system.root;
    while (cur) {
      save.bricks.push(cur.brick());
      cur = cur.next;
    }

    if (!save.bricks.length) {
      this.freeUuid(id);
    }

    return [save, id];
  };

  saveEmitters = async () => {
    await this.store.set('emitters', this.emitters);
  };

  async init() {
    this.data = loadParticleFile('plugins/fireworks/ny24.config.json');
    this.emitters = (await this.store.get('emitters')) ?? [];

    let time = Date.now();

    this.allUuids = (await this.store.get('uuids')) ?? [];
    this.freeUuids = [...this.allUuids];

    for (const uuid of this.allUuids) {
      this.omegga.clearBricks(uuid, true);
    }

    // simulation loop
    setInterval(async () => {
      try {
        const now = Date.now();
        const delta = now - time;
        time = now;

        this.system.simulate(delta / 1000.0);

        const [save, newId] = this.generateSave();
        if (save.bricks.length) {
          await this.omegga.loadSaveData(save, { quiet: true });
        }

        if (this.lastUuid) {
          this.freeUuid(this.lastUuid);
          this.omegga.clearBricks(this.lastUuid, true);
        }

        this.lastUuid = save.bricks.length ? newId : undefined;
      } catch (e) {
        console.error('Failed to simulate particles:', e);
      }
    }, this.config.update_rate);

    const onCommand = async (speaker: string, ...args: string[]) => {
      if (!this.isAuthorized(speaker)) {
        return;
      }

      const w = (...message: string[]) =>
        this.omegga.whisper(speaker, message.join(''));

      if (args[0] === 'emitters') {
        if (args[1] === 'new') {
          if (args.length <= 2) {
            w(
              'You must specify a name for the emitter (with no spaces) followed by the categories it belongs to.'
            );
            return;
          }

          const [name, ...categories] = args.slice(2);
          if (
            this.emitters.find(
              (e) => e.name.toLowerCase() === name.trim().toLowerCase()
            )
          ) {
            w('An emitter already exists with that name.');
            return;
          }

          const position = await this.omegga.getPlayer(speaker).getPosition();

          this.emitters.push({ name: name.trim(), position, categories });
          await this.saveEmitters();
          w('Created the emitter ', code(name.trim()), '.');
        } else if (args[1] === 'delete') {
          if (args.length <= 2) {
            w('You must specify a name for the emitter to delete.');
            return;
          }

          const name = args[2].trim();

          const filtered = this.emitters.filter(
            (e) => e.name.toLowerCase() === name.toLowerCase()
          );
          if (!filtered.length) {
            w('No emitters found with that name.');
            return;
          }

          this.emitters = filtered;
          await this.saveEmitters();
          w('Removed that emitter.');
        } else if (args[1] === 'list') {
          w('List of emitters:');
          for (const e of this.emitters) {
            w(
              '- ',
              cyan(e.name),
              ' [',
              e.categories.map(yellow).join(', '),
              '] at ',
              code(e.position.join(', '))
            );
          }
        }
      } else if (args[0] === 'shows') {
        if (args[1] === 'start') {
          if (!args[2]) {
            w(
              'Please specify a show to start. Use ',
              code('/fireworks shows list'),
              ' to see your options.'
            );
            return;
          }

          if (!this.emitters?.length) {
            w('There are no emitters. The show cannot start.');
            return;
          }

          const show = this.data.shows[args[2].trim()];
          if (!show) {
            w('Unable to find a show with that name.');
            return;
          }

          const timeouts: Record<string, NodeJS.Timeout> = {};
          const baseCategory = show.categories.all ?? {};
          const start = Date.now();

          for (const e of this.emitters) {
            let cat: Partial<CategoryDef> = baseCategory;
            let isSomeCategory = false;

            for (const c of e.categories) {
              if (c in show.categories) {
                isSomeCategory = true;
                cat = { ...cat, ...show.categories[c] };
              }
            }

            if (!isSomeCategory) {
              cat = { ...cat, ...show.categories.other };
            }

            const createTimeout = () =>
              setTimeout(() => {
                if (!cat.defs) return;

                const def =
                  cat.defs[Math.floor(Math.random() * cat.defs.length)];
                this.system.addParticle(
                  Particle.fromDef(
                    this.system,
                    this.data.defs[def],
                    ...e.position
                  )
                );

                if (Date.now() < start + show.length * 1_000) {
                  timeouts[e.name] = createTimeout();
                }
              }, computeRange(cat.interval) * 1_000);

            timeouts[e.name] = createTimeout();
          }

          const stopTimeout = setTimeout(() => {
            this.showActive = false;
            delete this.abortShow;
            console.log('The show has ended.');
          }, show.length * 1_000);

          this.showActive = true;
          this.abortShow = () => {
            this.showActive = false;
            delete this.abortShow;
            clearTimeout(stopTimeout);
            Object.values(timeouts).forEach(clearTimeout);
            console.log('The show has been aborted.');
          };
        } else if (args[1] === 'stop') {
          if (!this.showActive) {
            w('No show is active.');
            return;
          }

          this.abortShow();
          w('Show stopped. What a show-stopper.');
        } else if (args[1] === 'list') {
          w('List of shows:');
          for (const [name] of Object.entries(this.data.shows)) {
            w('- ', cyan(name));
          }
        }
      } else {
        // ...
      }
    };

    this.omegga.on(
      'cmd:fireworks',
      async (speaker: string, ...args: string[]) => {
        try {
          await onCommand(speaker, ...args);
          // const player = this.omegga.getPlayer(speaker);
          // const position = await player.getPosition();

          // if (!(name in data.defs)) {
          //   this.omegga.whisper(
          //     speaker,
          //     "Couldn't find a particle with that name."
          //   );
          //   return;
          // }

          // this.system.addParticle(
          //   Particle.fromDef(this.system, data.defs[name], ...position)
          // );
        } catch (e) {
          console.error('Firework command error:', e);
        }
      }
    );

    return { registeredCommands: ['fireworks'] };
  }

  async stop() {}
}
