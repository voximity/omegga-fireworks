import OmeggaPlugin, { OL, PS, PC, WriteSaveObject } from 'omegga';
import Particle, { ParticleDef, ParticleSystem } from './particle';

const { random: uuid } = OMEGGA_UTIL.uuid;

export type Config = { update_rate: number };
type Storage = { uuids: string[] };

const BASIC_FIREWORK: ParticleDef = {
  size: 5,
  color: [255, 255, 255],
  velocity: [0, 0, [400, 600]],
  lifespan: [1.6, 2.4],
  numChildren: [75, 100],
  children: [
    {
      color: [[0, 360], 255, 255],
      hsv: true,
      size: 3,
      velocity: [80, 125],
      randomVelocity: true,
      lifespan: [2.5, 3.5],
      gravity: 0.5,
      preSimulate: 0.5,
    },
  ],
};

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
      brick_owners: [{ name: 'Firework particle', id }],
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

    this.omegga.on('cmd:firework', async (speaker: string) => {
      try {
        const player = this.omegga.getPlayer(speaker);
        const position = await player.getPosition();

        this.system.addParticle(
          Particle.fromDef(this.system, BASIC_FIREWORK, ...position)
        );
      } catch (e) {
        console.error('Error creating firework:', e);
      }
    });

    return { registeredCommands: ['firework'] };
  }

  async stop() {}
}
