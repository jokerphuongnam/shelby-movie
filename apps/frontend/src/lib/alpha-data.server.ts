// Server-only — never import from client components or pages with "use client"
// Video URLs live exclusively here so they never appear in the browser JS bundle.

const GCS = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/";

export const ALPHA_VIDEO_MAP: Record<string, string> = {
  "alpha-0": `${GCS}BigBuckBunny.mp4`,
  "alpha-1": `${GCS}ElephantsDream.mp4`,
  "alpha-2": `${GCS}TearsOfSteel.mp4`,
  "alpha-3": `${GCS}ForBiggerEscapes.mp4`,
  "alpha-4": `${GCS}VolkswagenGTIReview.mp4`,
  "alpha-5": `${GCS}SubaruOutbackOnStreetAndDirt.mp4`,
  "alpha-6": `${GCS}ForBiggerBlazes.mp4`,
  "alpha-7": `${GCS}Sintel.mp4`,
};
