import * as THREE from 'three';
import { state } from '../state';

/**
 * Capa de nubes en sky-dome. Raymarch ligero a través de un slab esférico
 * (1.5km–3km) con fbm 3D, sombra hacia el sol con 3 muestras y tinte
 * dependiente de la elevación solar para que se vuelvan rosa/naranja
 * al atardecer.
 *
 * Se renderiza como una esfera BackSide algo más pequeña que la del cielo,
 * transparente, después del cielo y antes del paisaje.
 */

const vertexShader = /* glsl */ `
varying vec3 vWorldDir;
void main(){
  vWorldDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vWorldDir;

uniform vec3 uSunDir;
uniform float uTime;
uniform float uCoverage;
uniform float uSpeed;
uniform float uHeight;
uniform float uDensity;
uniform float uSharpness;

const float R = 6360e3;

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  float n000 = hash(i + vec3(0.,0.,0.));
  float n100 = hash(i + vec3(1.,0.,0.));
  float n010 = hash(i + vec3(0.,1.,0.));
  float n110 = hash(i + vec3(1.,1.,0.));
  float n001 = hash(i + vec3(0.,0.,1.));
  float n101 = hash(i + vec3(1.,0.,1.));
  float n011 = hash(i + vec3(0.,1.,1.));
  float n111 = hash(i + vec3(1.,1.,1.));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

float fbm(vec3 p){
  float v = 0.0;
  float a = 0.5;
  mat3 rot = mat3(0.80, 0.36, 0.48,
                 -0.48, 0.86, 0.16,
                 -0.36,-0.36, 0.86);
  for(int i=0;i<5;i++){
    v += a * noise3(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

vec2 raySphere(vec3 ro, vec3 rd, float r){
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r*r;
  float h = b*b - c;
  if(h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

float cloudDensity(vec3 p, float layerCenter, float layerHalf){
  // Falloff vertical dentro del slab
  float h = length(p) - layerCenter;
  float vfall = 1.0 - smoothstep(0.0, layerHalf, abs(h));
  if(vfall <= 0.0) return 0.0;

  vec3 q = p * 0.00012;
  q.xz += vec2(uTime * uSpeed, uTime * uSpeed * 0.7);
  // Eje y comprimido para que las nubes sean horizontales
  q.y *= 2.5;
  float n = fbm(q);

  float cov = uCoverage;
  float edge = mix(0.5, 0.02, uSharpness);
  float d = smoothstep(1.0 - cov - edge, 1.0 - cov + edge, n);
  return d * vfall * uDensity;
}

void main(){
  vec3 rd = normalize(vWorldDir);
  if(rd.y < 0.005){
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 ro = vec3(0.0, R + 3.0, 0.0);
  float layerBottom = R + 1500.0 + uHeight * 4000.0;
  float layerTop    = layerBottom + 1800.0;
  float layerCenter = (layerBottom + layerTop) * 0.5;
  float layerHalf   = (layerTop - layerBottom) * 0.5;

  vec2 tB = raySphere(ro, rd, layerBottom);
  vec2 tT = raySphere(ro, rd, layerTop);
  float t0 = max(tB.y, 0.0);
  float t1 = max(tT.y, t0);
  if(t1 <= t0){
    gl_FragColor = vec4(0.0);
    return;
  }

  const int N = 10;
  float dt = (t1 - t0) / float(N);
  // Jitter pequeño para suavizar bandas
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  float transmittance = 1.0;
  vec3 scattered = vec3(0.0);

  float sunY = uSunDir.y;
  // Color base del sol (atardecer = cálido, mediodía = blanco, noche = azul oscuro)
  vec3 sunCol = mix(
    vec3(1.6, 0.55, 0.22),
    mix(vec3(1.7, 1.2, 0.85), vec3(1.5, 1.45, 1.35), smoothstep(0.15, 0.45, sunY)),
    smoothstep(-0.02, 0.18, sunY)
  );
  sunCol *= smoothstep(-0.15, 0.05, sunY);
  vec3 ambient = mix(vec3(0.02, 0.04, 0.08), vec3(0.42, 0.52, 0.62), smoothstep(-0.1, 0.3, sunY));

  for(int i=0;i<N;i++){
    float t = t0 + (float(i) + jitter) * dt;
    vec3 p = ro + rd * t;
    float d = cloudDensity(p, layerCenter, layerHalf);
    if(d > 0.005){
      // Light march hacia el sol (3 saltos)
      float ls = 0.0;
      float lstep = 250.0;
      for(int j=0;j<3;j++){
        vec3 lp = p + uSunDir * float(j+1) * lstep;
        ls += cloudDensity(lp, layerCenter, layerHalf);
        lstep *= 2.0;
      }
      float lightTrans = exp(-ls * 1.4);
      vec3 lit = sunCol * lightTrans + ambient;
      // Powder-style: oscurece el borde "delgado" -> más volumen percibido
      float powder = 1.0 - exp(-d * 6.0);
      lit *= powder;

      float density = d * dt * 0.0015;
      vec3 transm = vec3(exp(-density));
      scattered += transmittance * (1.0 - transm.x) * lit;
      transmittance *= transm.x;
      if(transmittance < 0.01) break;
    }
  }

  float alpha = 1.0 - transmittance;
  // Atenúa cerca del horizonte para que no recorte feo
  float horizonFade = smoothstep(0.0, 0.06, rd.y);
  alpha *= horizonFade;
  gl_FragColor = vec4(scattered, alpha);
}
`;

export class Clouds {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private sunDir = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      blending: THREE.NormalBlending,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uTime: { value: 0 },
        uCoverage: { value: state.cloudCoverage },
        uSpeed: { value: state.cloudSpeed },
        uHeight: { value: state.cloudHeight },
        uDensity: { value: state.cloudDensity },
        uSharpness: { value: state.cloudSharpness },
      },
    });
    const geom = new THREE.SphereGeometry(1, 64, 32);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
    this.mesh.scale.setScalar(1800);
  }

  setSunDirection(dir: THREE.Vector3) {
    this.sunDir.copy(dir);
  }

  update(timeSeconds: number) {
    this.material.uniforms.uTime.value = timeSeconds;
    this.material.uniforms.uCoverage.value = state.cloudCoverage;
    this.material.uniforms.uSpeed.value = state.cloudSpeed;
    this.material.uniforms.uHeight.value = state.cloudHeight;
    this.material.uniforms.uDensity.value = state.cloudDensity;
    this.material.uniforms.uSharpness.value = state.cloudSharpness;
  }
}
