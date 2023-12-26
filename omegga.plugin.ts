import OmeggaPlugin, { OL, PS, PC, WriteSaveObject } from 'omegga';
import Particle, { ParticleSystem } from './particle';
import { ParticleDef, ParticleFile } from './format';
import fs from 'fs';

const { random: uuid } = OMEGGA_UTIL.uuid;

export type Config = { update_rate: number };
type Storage = { uuids: string[] };

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

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;

    this.system = new ParticleSystem(config);
  }

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

  async init() {
    const data = loadParticleFile('plugins/fireworks/ny24.json');

    let time = Date.now();

    this.allUuids = (await this.store.get('uuids')) ?? [];
    this.freeUuids = [...this.allUuids];

    console.log('cached', this.allUuids.length, 'uuids');

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

    this.omegga.on('cmd:firework', async (speaker: string, name: string) => {
      try {
        const player = this.omegga.getPlayer(speaker);
        const position = await player.getPosition();

        if (!(name in data.defs)) {
          this.omegga.whisper(
            speaker,
            "Couldn't find a particle with that name."
          );
          return;
        }

        this.system.addParticle(
          Particle.fromDef(this.system, data.defs[name], ...position)
        );
      } catch (e) {
        console.error('Error creating firework:', e);
      }
    });

    return { registeredCommands: ['firework'] };
  }

  async stop() {}
}
