export interface Track {
  title: string;
  author: string;
  duration: number; // in ms
  uri?: string;
  encoded: string; // Encoded track string from Lavalink
  artworkUrl?: string;
  requestedById?: string;
  source?: string;
}
