import * as THREE from 'three';
import { state } from '../state';

/**
 * Tres paisajes intercambiables con cross-fade:
 *   blend ∈ [0,2]
 *     0  -> mountains-lake
 *     1  -> desert
 *     2  -> coast-lighthouse
 *
 * Cada paisaje es una sub-escena ligera (silueta lejana + plano cercano)
 * con sus propios shaders. Todo se ilumina con `uSunDir` + `uSunColor`
 * derivados del shader atmosférico para que el color encaje con el cielo
 * (atardecer dorado, noche azulada, etc.).
 */

/**
 * Bloque común para shaders de paisaje: fbm 3D + proyección de sombras
 * de nubes desde la posición del fragmento hacia el plano de nubes a lo
 * largo del rayo del sol. Se reusa el mismo campo de ruido que la capa
 * de nubes para que la sombra "case" con lo que se ve arriba.
 */
const FRAG_COMMON = /* glsl */ `
uniform float uCloudCoverage;
uniform float uCloudSpeed;
uniform float uCloudHeight;
uniform float uCloudSharpness;

float hash3(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(hash3(i + vec3(0,0,0)), hash3(i + vec3(1,0,0)), f.x),
                 mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
                 mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){
  float v = 0.0; float a = 0.5;
  mat3 rot = mat3(0.80, 0.36, 0.48, -0.48, 0.86, 0.16, -0.36, -0.36, 0.86);
  for(int i=0;i<4;i++){ v += a * noise3(p); p = rot * p * 2.02; a *= 0.5; }
  return v;
}

float cloudShadow(vec3 worldPos, vec3 sunDir, float time){
  if(uCloudCoverage < 0.02 || sunDir.y < 0.02) return 0.0;
  float cloudY = 1500.0 + uCloudHeight * 4000.0 + 900.0;
  float t = (cloudY - worldPos.y) / sunDir.y;
  vec3 hit = worldPos + sunDir * t;
  vec3 q = hit * 0.00012;
  q.xz += time * uCloudSpeed * vec2(1.0, 0.7);
  q.y *= 2.5;
  float n = fbm3(q);
  float edge = mix(0.45, 0.02, uCloudSharpness);
  return smoothstep(1.0 - uCloudCoverage - edge, 1.0 - uCloudCoverage + edge, n);
}
`;

const VS_TERRAIN = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
uniform float uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0; float a = 0.5;
  for(int i=0;i<5;i++){ v += a*vnoise(p); p *= 2.07; a *= 0.5; }
  return v;
}
`;

/* =========================================================================
 * 1. Mountains + Lake
 * ========================================================================= */

const MOUNTAINS_VS = VS_TERRAIN + /* glsl */ `
uniform float uAmplitude;
void main(){
  vec3 p = position;
  // Distance-based height: las montañas están lejos
  float d = length(p.xz);
  // Capas de fbm para tener detalle medio y grande
  float h = fbm(p.xz * 0.0035 + vec2(11.0, 23.0)) * 1.0
          + fbm(p.xz * 0.013 + vec2(3.0, 7.0)) * 0.4;
  // Solo alza más allá de un radio (foreground es plano)
  float mask = smoothstep(120.0, 260.0, d);
  h = pow(h, 1.6) * mask * uAmplitude;
  p.y += h;
  vHeight = h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;

  // normal estimada por diferencias
  vec2 e = vec2(2.0, 0.0);
  float hL = fbm((p.xz - e.xy) * 0.0035 + vec2(11.0, 23.0)) * 1.0 + fbm((p.xz - e.xy)*0.013 + vec2(3.0,7.0))*0.4;
  float hR = fbm((p.xz + e.xy) * 0.0035 + vec2(11.0, 23.0)) * 1.0 + fbm((p.xz + e.xy)*0.013 + vec2(3.0,7.0))*0.4;
  float hD = fbm((p.xz - e.yx) * 0.0035 + vec2(11.0, 23.0)) * 1.0 + fbm((p.xz - e.yx)*0.013 + vec2(3.0,7.0))*0.4;
  float hU = fbm((p.xz + e.yx) * 0.0035 + vec2(11.0, 23.0)) * 1.0 + fbm((p.xz + e.yx)*0.013 + vec2(3.0,7.0))*0.4;
  vec3 n = normalize(vec3(pow(hL,1.6) - pow(hR,1.6), 4.0, pow(hD,1.6) - pow(hU,1.6)));
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MOUNTAINS_FS = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientLow;
uniform vec3 uAmbientHigh;
uniform float uOpacity;
uniform float uTime;
` + FRAG_COMMON + /* glsl */ `
void main(){
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);
  // Sombra de nubes
  float cs = cloudShadow(vWorldPos, L, uTime);
  float lit = ndl * (1.0 - cs * 0.85);
  // Lit + ambient gradient
  float upDot = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uAmbientLow, uAmbientHigh, upDot);
  // Roca: más contraste y veteado por altura
  float veta = noise3(vWorldPos * vec3(0.02, 0.04, 0.02));
  vec3 albedo = mix(vec3(0.04, 0.05, 0.07), vec3(0.22, 0.19, 0.16), smoothstep(0.0, 40.0, vHeight));
  albedo = mix(albedo, albedo * 0.6, veta * 0.5);
  // Nieve en cumbres
  float snow = smoothstep(55.0, 85.0, vHeight) * smoothstep(0.55, 0.85, N.y);
  albedo = mix(albedo, vec3(0.78, 0.82, 0.88), snow);

  vec3 col = albedo * (uSunColor * lit + ambient);
  // Rim warm en cumbres cuando el sol está bajo
  float rim = pow(1.0 - max(N.y, 0.0), 2.0) * smoothstep(0.0, 0.18, L.y) * smoothstep(0.3, 0.0, L.y);
  col += rim * uSunColor * 0.35 * (1.0 - cs);
  // Aerial perspective con la distancia
  float d = length(vWorldPos.xz);
  float fog = smoothstep(180.0, 460.0, d);
  vec3 fogCol = mix(uAmbientLow, uAmbientHigh, 0.7) * 1.1;
  col = mix(col, fogCol, fog * 0.85);
  gl_FragColor = vec4(col, uOpacity);
}
`;

const LAKE_VS = /* glsl */ `
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LAKE_FS = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform float uTime;
uniform float uOpacity;
` + FRAG_COMMON + /* glsl */ `

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

void main(){
  vec3 V = normalize(cameraPosition - vWorldPos);
  // Pequeña perturbación de normal (ondas finas)
  vec2 q = vWorldPos.xz * 0.5;
  float n1 = vnoise(q * 0.13 + uTime * 0.08);
  float n2 = vnoise(q * 0.31 - uTime * 0.05);
  vec3 N = normalize(vec3((n1 - 0.5) * 0.08, 1.0, (n2 - 0.5) * 0.08));

  vec3 R = reflect(-V, N);
  // Cielo reflejado: gradiente simple coherente con horizonte/zenith
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uZenithColor, smoothstep(0.0, 0.45, h));

  // Reflejo del sol (anisotrópico vertical => columna larga)
  vec3 sunDirRefl = vec3(uSunDir.x, -uSunDir.y, uSunDir.z);
  float gl1 = pow(max(dot(R, normalize(sunDirRefl)), 0.0), 400.0);
  float gl2 = pow(max(dot(R, normalize(sunDirRefl)), 0.0), 16.0) * 0.18;
  vec3 sun = uSunColor * (gl1 * 12.0 + gl2);

  // Fresnel (Schlick) – el agua refleja más en grazing angles
  float NdotV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  vec3 deep = mix(vec3(0.01, 0.02, 0.035), vec3(0.04, 0.07, 0.10), uSunColor.r);
  // Sombra de nube atenúa el reflejo del sol pero no el azul base
  float cs = cloudShadow(vWorldPos, normalize(uSunDir), uTime);
  vec3 col = mix(deep, sky, F) + sun * F * (1.0 - cs * 0.8);
  // Pequeño "fog" cercano para integrar con el horizonte
  float d = length(vWorldPos.xz);
  float fog = smoothstep(80.0, 240.0, d);
  col = mix(col, uHorizonColor, fog * 0.55);
  gl_FragColor = vec4(col, uOpacity);
}
`;

/* =========================================================================
 * 2. Desert / Dunes
 * ========================================================================= */

const DESERT_VS = VS_TERRAIN + /* glsl */ `
uniform float uAmplitude;
void main(){
  vec3 p = position;
  // Dunas: ondas largas + detalle de granos
  float dune = sin(p.x * 0.014) * cos(p.z * 0.011) * 8.0
             + sin(p.x * 0.05 + p.z * 0.03) * 2.5;
  float detail = fbm(p.xz * 0.06) * 1.2;
  float h = (dune + detail) * uAmplitude;
  p.y += h;
  vHeight = h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;

  // Normal aprox.
  vec2 e = vec2(1.0, 0.0);
  float hL = sin((p.x-1.0)*0.014)*cos(p.z*0.011)*8.0 + sin((p.x-1.0)*0.05 + p.z*0.03)*2.5 + fbm((p.xz - e.xy)*0.06)*1.2;
  float hR = sin((p.x+1.0)*0.014)*cos(p.z*0.011)*8.0 + sin((p.x+1.0)*0.05 + p.z*0.03)*2.5 + fbm((p.xz + e.xy)*0.06)*1.2;
  float hD = sin(p.x*0.014)*cos((p.z-1.0)*0.011)*8.0 + sin(p.x*0.05 + (p.z-1.0)*0.03)*2.5 + fbm((p.xz - e.yx)*0.06)*1.2;
  float hU = sin(p.x*0.014)*cos((p.z+1.0)*0.011)*8.0 + sin(p.x*0.05 + (p.z+1.0)*0.03)*2.5 + fbm((p.xz + e.yx)*0.06)*1.2;
  vec3 n = normalize(vec3((hL - hR) * uAmplitude, 4.0, (hD - hU) * uAmplitude));
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const DESERT_FS = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vHeight;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientLow;
uniform vec3 uAmbientHigh;
uniform float uOpacity;
uniform float uTime;
` + FRAG_COMMON + /* glsl */ `
void main(){
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);
  float cs = cloudShadow(vWorldPos, L, uTime);
  float lit = ndl * (1.0 - cs * 0.85);
  float upDot = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uAmbientLow, uAmbientHigh, upDot);
  // Arena cálida con variación local
  float grain = noise3(vWorldPos * 0.6) * 0.15;
  vec3 sand = mix(vec3(0.45, 0.32, 0.20), vec3(0.82, 0.66, 0.44), smoothstep(-2.0, 6.0, vHeight));
  sand *= 1.0 - grain;
  vec3 col = sand * (uSunColor * lit + ambient * 1.1);
  float d = length(vWorldPos.xz);
  float fog = smoothstep(220.0, 480.0, d);
  vec3 fogCol = mix(uAmbientLow, uAmbientHigh, 0.6);
  col = mix(col, fogCol, fog * 0.85);
  gl_FragColor = vec4(col, uOpacity);
}
`;

/* =========================================================================
 * 3. Coast + Lighthouse
 * ========================================================================= */

const COAST_VS = LAKE_VS;
const COAST_FS = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform float uTime;
uniform float uOpacity;
` + FRAG_COMMON + /* glsl */ `

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0; float a=0.5;
  for(int i=0;i<4;i++){ v += a*vnoise(p); p *= 2.05; a *= 0.5; }
  return v;
}

void main(){
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec2 q = vWorldPos.xz * 0.35;
  // Olas: dos escalas
  float wave = fbm(q * 0.15 + vec2(uTime * 0.15, uTime * 0.08));
  float fine = fbm(q * 0.6  + vec2(-uTime * 0.07, uTime * 0.05));
  vec3 N = normalize(vec3((wave - 0.5) * 0.35, 1.0, (fine - 0.5) * 0.35));

  vec3 R = reflect(-V, N);
  float h = clamp(R.y, 0.0, 1.0);
  vec3 sky = mix(uHorizonColor, uZenithColor, smoothstep(0.0, 0.45, h));

  vec3 sunDirRefl = vec3(uSunDir.x, -uSunDir.y, uSunDir.z);
  float gl1 = pow(max(dot(R, normalize(sunDirRefl)), 0.0), 220.0);
  float gl2 = pow(max(dot(R, normalize(sunDirRefl)), 0.0), 12.0) * 0.2;
  float cs = cloudShadow(vWorldPos, normalize(uSunDir), uTime);
  vec3 sun = uSunColor * (gl1 * 10.0 + gl2) * (1.0 - cs * 0.8);

  float NdotV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  vec3 deep = vec3(0.01, 0.03, 0.06);
  vec3 col = mix(deep, sky, F) + sun * F;

  // Crestas de espuma
  float foam = smoothstep(0.62, 0.78, wave) * smoothstep(0.55, 0.85, fine);
  col = mix(col, vec3(0.88, 0.92, 0.95), foam * 0.6);

  float d = length(vWorldPos.xz);
  float fog = smoothstep(120.0, 320.0, d);
  col = mix(col, uHorizonColor, fog * 0.6);
  gl_FragColor = vec4(col, uOpacity);
}
`;

const LIGHTHOUSE_VS = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LIGHTHOUSE_FS = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec3 vNormal;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientLow;
uniform vec3 uAmbientHigh;
uniform float uOpacity;
uniform float uLanternOn; // 0..1
uniform float uTime;
void main(){
  vec3 N = normalize(vNormal);
  float ndl = max(dot(N, normalize(uSunDir)), 0.0);
  vec3 ambient = mix(uAmbientLow, uAmbientHigh, N.y * 0.5 + 0.5);
  // Bandas rojo/blanco del faro: usa altura
  float band = step(0.5, fract(vWorldPos.y * 0.18));
  vec3 albedo = mix(vec3(0.78, 0.78, 0.78), vec3(0.65, 0.08, 0.08), band);
  // Plataforma de la linterna (parte superior) en otro material
  if(vWorldPos.y > 21.5) albedo = vec3(0.12, 0.12, 0.12);
  vec3 col = albedo * (uSunColor * ndl + ambient * 0.9);
  // Linterna emitting al anochecer
  if(vWorldPos.y > 22.5 && vWorldPos.y < 25.0){
    float pulse = 0.5 + 0.5 * sin(uTime * 1.2);
    col += vec3(2.2, 1.8, 1.1) * uLanternOn * (0.6 + 0.4 * pulse);
  }
  gl_FragColor = vec4(col, uOpacity);
}
`;

/* =========================================================================
 * Manager
 * ========================================================================= */

interface SceneBundle {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  setOpacity(o: number): void;
}

export class Landscape {
  readonly group = new THREE.Group();
  private mountains: SceneBundle;
  private desert: SceneBundle;
  private coast: SceneBundle;

  private sunDir = new THREE.Vector3(0, 1, 0);
  private sunColor = new THREE.Color(1, 1, 1);
  private ambientLow = new THREE.Color(0.03, 0.04, 0.07);
  private ambientHigh = new THREE.Color(0.5, 0.6, 0.75);
  private horizonColor = new THREE.Color(0.6, 0.55, 0.5);
  private zenithColor = new THREE.Color(0.2, 0.35, 0.55);

  constructor() {
    this.mountains = this.buildMountains();
    this.desert = this.buildDesert();
    this.coast = this.buildCoast();
    this.group.add(this.mountains.group, this.desert.group, this.coast.group);
  }

  private commonUniforms() {
    return {
      uSunDir: { value: this.sunDir },
      uSunColor: { value: this.sunColor },
      uAmbientLow: { value: this.ambientLow },
      uAmbientHigh: { value: this.ambientHigh },
      uOpacity: { value: 1.0 },
      uTime: { value: 0 },
      uHorizonColor: { value: this.horizonColor },
      uZenithColor: { value: this.zenithColor },
      uCloudCoverage: { value: state.cloudCoverage },
      uCloudSpeed: { value: state.cloudSpeed },
      uCloudHeight: { value: state.cloudHeight },
      uCloudSharpness: { value: state.cloudSharpness },
    };
  }

  private buildMountains(): SceneBundle {
    const group = new THREE.Group();
    // Lake (plano cercano)
    const lakeMat = new THREE.ShaderMaterial({
      vertexShader: LAKE_VS,
      fragmentShader: LAKE_FS,
      transparent: true,
      depthWrite: true,
      uniforms: this.commonUniforms(),
    });
    const lakeGeom = new THREE.PlaneGeometry(2000, 2000, 1, 1);
    lakeGeom.rotateX(-Math.PI / 2);
    const lake = new THREE.Mesh(lakeGeom, lakeMat);
    lake.position.y = -0.5;
    group.add(lake);

    // Mountain ring
    const mountUniforms = { ...this.commonUniforms(), uAmplitude: { value: 145 } };
    const mountainMat = new THREE.ShaderMaterial({
      vertexShader: MOUNTAINS_VS,
      fragmentShader: MOUNTAINS_FS,
      transparent: true,
      uniforms: mountUniforms,
    });
    const mountGeom = new THREE.PlaneGeometry(900, 900, 256, 256);
    mountGeom.rotateX(-Math.PI / 2);
    const mounts = new THREE.Mesh(mountGeom, mountainMat);
    mounts.position.y = -0.2;
    group.add(mounts);

    return {
      group,
      materials: [lakeMat, mountainMat],
      setOpacity: (o: number) => {
        lakeMat.uniforms.uOpacity.value = o;
        mountainMat.uniforms.uOpacity.value = o;
        group.visible = o > 0.001;
      },
    };
  }

  private buildDesert(): SceneBundle {
    const group = new THREE.Group();
    const uniforms = { ...this.commonUniforms(), uAmplitude: { value: 1.0 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: DESERT_VS,
      fragmentShader: DESERT_FS,
      transparent: true,
      uniforms,
    });
    const g = new THREE.PlaneGeometry(1600, 1600, 320, 320);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.y = -1;
    group.add(m);

    return {
      group,
      materials: [mat],
      setOpacity: (o: number) => {
        mat.uniforms.uOpacity.value = o;
        group.visible = o > 0.001;
      },
    };
  }

  private buildCoast(): SceneBundle {
    const group = new THREE.Group();

    const seaMat = new THREE.ShaderMaterial({
      vertexShader: COAST_VS,
      fragmentShader: COAST_FS,
      transparent: true,
      uniforms: this.commonUniforms(),
    });
    const seaGeom = new THREE.PlaneGeometry(2400, 2400, 1, 1);
    seaGeom.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(seaGeom, seaMat);
    sea.position.y = -0.5;
    group.add(sea);

    // Lighthouse mesh: pequeño rock + torre cilíndrica + plataforma
    const lhUniforms = { ...this.commonUniforms(), uLanternOn: { value: 0 } };
    const lhMat = new THREE.ShaderMaterial({
      vertexShader: LIGHTHOUSE_VS,
      fragmentShader: LIGHTHOUSE_FS,
      transparent: true,
      uniforms: lhUniforms,
    });
    const lhGroup = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.ConeGeometry(14, 8, 16, 1), lhMat);
    rock.position.y = 4;
    lhGroup.add(rock);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.2, 6, 24), lhMat);
    base.position.y = 11; lhGroup.add(base);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.0, 14, 24), lhMat);
    tower.position.y = 21; lhGroup.add(tower);
    const lanternPlate = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 24), lhMat);
    lanternPlate.position.y = 28.25; lhGroup.add(lanternPlate);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.6, 16), lhMat);
    lantern.position.y = 29.3; lhGroup.add(lantern);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.2, 16), lhMat);
    roof.position.y = 31.2; lhGroup.add(roof);

    // Coloca el faro alejado a un lado para que sea silueta
    lhGroup.position.set(180, -2, -90);
    group.add(lhGroup);

    return {
      group,
      materials: [seaMat, lhMat],
      setOpacity: (o: number) => {
        seaMat.uniforms.uOpacity.value = o;
        lhMat.uniforms.uOpacity.value = o;
        group.visible = o > 0.001;
      },
    };
  }

  setLighting(
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    ambientLow: THREE.Color,
    ambientHigh: THREE.Color,
    horizon: THREE.Color,
    zenith: THREE.Color,
  ) {
    this.sunDir.copy(sunDir);
    this.sunColor.copy(sunColor);
    this.ambientLow.copy(ambientLow);
    this.ambientHigh.copy(ambientHigh);
    this.horizonColor.copy(horizon);
    this.zenithColor.copy(zenith);
  }

  update(timeSeconds: number, sunY: number) {
    // tiempo + parámetros de nubes para sombras drift en el paisaje
    const allMats = [...this.mountains.materials, ...this.desert.materials, ...this.coast.materials];
    for (const m of allMats) {
      if (m.uniforms.uTime) m.uniforms.uTime.value = timeSeconds;
      if (m.uniforms.uCloudCoverage) m.uniforms.uCloudCoverage.value = state.cloudCoverage;
      if (m.uniforms.uCloudSpeed) m.uniforms.uCloudSpeed.value = state.cloudSpeed;
      if (m.uniforms.uCloudHeight) m.uniforms.uCloudHeight.value = state.cloudHeight;
      if (m.uniforms.uCloudSharpness) m.uniforms.uCloudSharpness.value = state.cloudSharpness;
    }
    // Linterna del faro encendida al anochecer / noche
    const lanternOn = THREE.MathUtils.clamp(0.1 - sunY, 0, 1);
    const lhMat = this.coast.materials[1];
    if (lhMat.uniforms.uLanternOn) lhMat.uniforms.uLanternOn.value = lanternOn;

    // Cross-fade
    const b = THREE.MathUtils.clamp(state.landscapeBlend, 0, 2);
    let oM = 0, oD = 0, oC = 0;
    if (b < 1) { oM = 1 - b; oD = b; }
    else { oD = 2 - b; oC = b - 1; }
    this.mountains.setOpacity(oM);
    this.desert.setOpacity(oD);
    this.coast.setOpacity(oC);
  }
}
