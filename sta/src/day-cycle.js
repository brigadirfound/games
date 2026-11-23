const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x-a)/(b-a)));
  return t*t*(3-2*t);
};
export const DAY_LENGTH = 48 * 60;
// Shared periodic state for sky, illumination and colour grading.
export function sampleDay(hour) {
  const angle = (hour-6)/24*Math.PI*2;
  const elevation = Math.sin(angle);
  const night = 1-smooth(-0.35,0.35,elevation);
  const dusk = (1-smooth(0.03,0.48,Math.abs(elevation))) * (1-night*0.6);
  const x = Math.cos(angle), y = elevation, z = 0.28;
  const length = Math.hypot(x,y,z);
  return { night, dusk, sun: {x:x/length,y:y/length,z:z/length} };
}
