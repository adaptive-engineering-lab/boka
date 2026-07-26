/**
 * T009 — HEIC decode gate (FR-007).
 *
 * The designer uploads from a phone, and iOS produces HEIC. `sharp` can only decode it
 * when its libvips build includes libheif, which varies by platform and by deploy
 * target. Research D5 flags this as the assumption in the plan most likely to be wrong.
 *
 * Run this on the dev machine AND the deploy target before building the upload
 * pipeline. If it fails, the fallback is client-side WebAssembly conversion before
 * upload — a different design, and much cheaper to choose now than after T027 and T035
 * exist.
 */
import sharp from 'sharp';

const heif = sharp.format.heif;

const canRead = Boolean(heif?.input?.buffer);
const canWrite = Boolean(heif?.output?.buffer);

console.log(`sharp        ${sharp.versions.sharp}`);
console.log(`libvips      ${sharp.versions.vips}`);
console.log(`platform     ${process.platform}/${process.arch}`);
console.log('');
console.log(`HEIF decode  ${canRead ? 'YES' : 'NO'}   <-- required by FR-007`);
console.log(`HEIF encode  ${canWrite ? 'YES' : 'NO'}   (not required; we output WebP)`);
console.log('');

if (canRead) {
  console.log('PASS — HEIC uploads can be converted server-side. T009 satisfied.');
  process.exit(0);
}

console.error('FAIL — this build of sharp cannot decode HEIC.');
console.error('');
console.error('FR-007 requires accepting HEIC uploads. Options:');
console.error('  1. Install a sharp/libvips build with libheif on this platform.');
console.error('  2. Switch to the client-side WebAssembly fallback (research D5) and');
console.error('     revise T027 and T035 before implementing the upload pipeline.');
console.error('');
console.error('Do NOT proceed to T027 assuming server-side HEIC conversion works.');
process.exit(1);
