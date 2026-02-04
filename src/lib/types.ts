export type CardRow = Record<string, string>;

export type CardComputed = {
  id: string;
  title: string;
  player: string;
  set: string;
  season: string;
  team: string;
  league: string;
  features: string;
  images: string[];
  marketAvg: number | null;
  lastSold: number | null;
  lastSoldEnded: string;
  lastSoldUrl: string;
  delta: number | null;
};
