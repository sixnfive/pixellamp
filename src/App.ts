import * as THREE from 'three';
import { Sky } from './scene/Sky';
import { Clouds } from './scene/Clouds';
import { Stars } from './scene/Stars';
import { Landscape } from './scene/Landscape';
import { TimeOfDay } from './scene/TimeOfDay';
import { buildComposer, ComposerBundle } from './post/Composer';
import { buildPanel } from './ui/Panel';
import { state } from './state';
import GUI from 'lil-gui';

/**
 * Orquesta la escena. La cámara está fija, en posición de "espectador"
 * frente al paisaje: la pieza se piensa para ser proyectada sobre el
 * panel LED, no para navegarla con el ratón.
 */
export class App {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private sky: Sky;
  private clouds: Clouds;
  private stars: Stars;
  private landscape: Landscape;
  private timeOfDay: TimeOfDay;

  private composer: ComposerBundle;
  private panel: GUI;

  private clock = new THREE.Clock();
  private raf = 0;

  constructor(private container: HTMLElement) {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,         // antialias lo da el over-sampling + bloom + pixel
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = state.exposure;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    // Scene & camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 5000);
    // Cámara casi al nivel del agua, ligeramente inclinada hacia abajo
    // para que el horizonte quede a ~60% de altura y el paisaje respire.
    this.camera.position.set(0, 2.4, 22);
    this.camera.lookAt(0, 0.4, -200);

    // Subsistemas
    this.sky = new Sky();
    this.clouds = new Clouds();
    this.stars = new Stars(2800);
    this.landscape = new Landscape();
    this.timeOfDay = new TimeOfDay();

    this.scene.add(this.sky.mesh);
    this.scene.add(this.stars.group);
    this.scene.add(this.clouds.mesh);
    this.scene.add(this.landscape.group);

    // Post
    this.composer = buildComposer(this.renderer, this.scene, this.camera, w, h, pr);

    // Panel
    this.panel = buildPanel();

    // Resize
    window.addEventListener('resize', this.onResize);
    // Tecla H para ocultar panel
    window.addEventListener('keydown', this.onKey);
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.resize(w, h, pr);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'h' || e.key === 'H') {
      const el = (this.panel as unknown as { domElement: HTMLElement }).domElement;
      el.style.display = el.style.display === 'none' ? '' : 'none';
    }
  };

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  private tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    // Tiempo + iluminación derivada
    const frame = this.timeOfDay.tick(dt);

    // Empuja a subsistemas
    this.sky.setSunDirection(frame.sunDir);
    this.sky.update();
    this.clouds.setSunDirection(frame.sunDir);
    this.clouds.update(elapsed);
    this.stars.setSunDirection(frame.sunDir);
    this.stars.setMoonDirection(frame.moonDir);
    this.stars.update(elapsed);
    this.landscape.setLighting(
      frame.sunDir,
      frame.sunColor,
      frame.ambientLow,
      frame.ambientHigh,
      frame.horizonColor,
      frame.zenithColor,
    );
    this.landscape.update(elapsed, frame.sunY);

    // Exposición + post
    this.renderer.toneMappingExposure = state.exposure;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.composer.update(w, h);
    this.composer.composer.render();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.renderer.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.panel.destroy();
    this.renderer.domElement.remove();
  }
}
