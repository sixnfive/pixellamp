import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createPixelPass, updatePixelPass } from './PixelPass';
import { state } from '../state';

/**
 * Cadena de post-procesado:
 *
 *   Render → Pixel → Bloom → Output(sRGB + tonemap)
 *
 * El bloom va DESPUÉS del pase de pixelado para que cada LED brillante
 * tenga su propio halo (que es lo característico de un panel P0.9 en
 * salas oscuras). El tonemapping del renderer es AgX – da rojos de
 * atardecer y rolloff de luces especulares mucho mejor que ACES.
 */

export interface ComposerBundle {
  composer: EffectComposer;
  pixelPass: ShaderPass;
  bloomPass: UnrealBloomPass;
  resize(width: number, height: number, pixelRatio: number): void;
  update(width: number, height: number): void;
}

export function buildComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  pixelRatio: number,
): ComposerBundle {
  // Render target HDR (half-float)
  const renderTarget = new THREE.WebGLRenderTarget(
    Math.floor(width * pixelRatio),
    Math.floor(height * pixelRatio),
    {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 0,
    },
  );

  const composer = new EffectComposer(renderer, renderTarget);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const pixelPass = createPixelPass(
    Math.floor(width * pixelRatio),
    Math.floor(height * pixelRatio),
  );
  composer.addPass(pixelPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    state.bloomStrength,
    state.bloomRadius,
    state.bloomThreshold,
  );
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let currentPR = pixelRatio;
  return {
    composer,
    pixelPass,
    bloomPass,
    resize(w, h, pr) {
      currentPR = pr;
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      bloomPass.setSize(w, h);
    },
    update(w, h) {
      updatePixelPass(pixelPass, Math.floor(w * currentPR), Math.floor(h * currentPR));
      bloomPass.strength = state.bloomStrength;
      bloomPass.radius = state.bloomRadius;
      bloomPass.threshold = state.bloomThreshold;
    },
  };
}
