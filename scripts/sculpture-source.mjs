// Shader Park DSL: evaluated only by the build-time compiler, never in the browser.
export const sculptureSource = `
let t = input(0.0);
let warp = input(0.3);
let mood = input(0.5);
let seed = input(2.0);
let s = getSpace();
let n = sin(s.x*4.0+seed+t*.3)*cos(s.y*3.0+t*.2)*sin(s.z*4.0+seed);
metal(0.35);
shine(0.7);
color(0.45+sin(s.y*3.0+mood*3.0)*0.25,0.55+cos(s.x*2.0+seed)*0.25,0.7+sin(s.z*3.0)*0.2);
rotateY(t*.12);
sphere(0.82+n*warp*.38);
`;
