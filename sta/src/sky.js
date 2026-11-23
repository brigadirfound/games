import * as THREE from 'three';
import { sampleDay } from './day-cycle.js';

// Single opaque sky, independent sun and moon, continuous simulation-time clouds.
export class Sky {
  constructor(scene) {
    this.uniforms={uSun:{value:new THREE.Vector3()},uNight:{value:0},uDusk:{value:0},uTime:{value:0},uWeather:{value:0}};
    this.material=new THREE.ShaderMaterial({
      uniforms:this.uniforms,side:THREE.BackSide,depthWrite:false,depthTest:false,
      vertexShader: `varying vec3 vDirection;
        void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        precision highp float;
        varying vec3 vDirection;
        uniform vec3 uSun;
        uniform float uNight,uDusk,uTime,uWeather;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
        float fbm(vec2 p){float n=0.0,a=0.55;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+17.0;a*=0.49;}return n;}
        void main(){
          vec3 d=normalize(vDirection);
          float altitude=smoothstep(-0.08,0.75,d.y);
          vec3 horizon=mix(vec3(0.57,0.66,0.70),vec3(0.027,0.039,0.068),uNight);
          vec3 zenith=mix(vec3(0.105,0.25,0.41),vec3(0.006,0.012,0.030),uNight);
          vec3 col=mix(horizon,zenith,altitude);
          float towards=pow(max(0.0,dot(normalize(vec3(d.x,0.03,d.z)),normalize(vec3(uSun.x,0.03,uSun.z)))),3.0);
          col=mix(col,vec3(0.70,0.31,0.14),uDusk*towards*exp(-abs(d.y)*6.0)*0.65);
          float sun=dot(d,uSun),moon=dot(d,-uSun);
          col+=vec3(0.55,0.39,0.20)*pow(max(sun,0.0),28.0)*(1.0-uNight)*0.20;
          col+=vec3(1.0,0.85,0.59)*smoothstep(0.99982,0.99993,sun)*smoothstep(-0.12,0.02,uSun.y);
          col+=vec3(0.29,0.34,0.42)*smoothstep(0.99975,0.9999,moon)*uNight;
          vec2 starUV=vec2(atan(d.z,d.x)*80.0,asin(clamp(d.y,-1.0,1.0))*150.0);
          float star=step(0.993,hash(floor(starUV)))*pow(max(0.0,1.0-length(fract(starUV)-0.5)*2.0),10.0);
          col+=vec3(star*0.55*uNight*uNight*smoothstep(0.02,0.4,d.y));
          vec2 cloudUV=d.xz/(max(d.y,0.02)+0.22)*1.65+vec2(uTime*0.0017,uTime*0.0007);
          float cloud=smoothstep(0.48-uWeather*0.12,0.74,fbm(cloudUV));
          cloud*=smoothstep(0.01,0.18,d.y)*0.82;
          vec3 cloudCol=mix(vec3(0.76,0.78,0.77),vec3(0.055,0.063,0.082),uNight);
          cloudCol=mix(cloudCol,vec3(0.30,0.34,0.38),uWeather*(1.0-uNight)*0.6);
          col=mix(col,cloudCol,cloud);
          gl_FragColor=vec4(col,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh=new THREE.Mesh(new THREE.SphereGeometry(520,32,20),this.material);
    this.mesh.name='Continuous atmospheric sky';this.mesh.frustumCulled=false;this.mesh.renderOrder=-100;
    scene.add(this.mesh);
  }
  update(hour,night,sunDir,camPos,elapsed=0,weather=0) {
    const s=sampleDay(hour);
    this.uniforms.uSun.value.set(s.sun.x,s.sun.y,s.sun.z);
    this.uniforms.uNight.value=s.night;this.uniforms.uDusk.value=s.dusk;
    this.uniforms.uTime.value=elapsed;this.uniforms.uWeather.value=weather;
    this.mesh.position.copy(camPos);
  }
}
