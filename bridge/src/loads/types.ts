/** Normalized `/v1/loads/search` input ready for TMS LOAD_QUERY encoding. */
export type NormalizedSearchLoads = {
  equipment_type: string;
  origin_city?: string;
  origin_state?: string;
  dest_state?: string;
  pickup_date?: string;
};

export type SearchLoadsRequestBody = {
  equipment_type: string;
  origin_city?: string;
  origin_state?: string;
  dest_state?: string;
  pickup_date?: string;
};


export type LoadLocation = {
  city: string;
  state: string;
  zip: string;
};

/** Agent-safe load fields (posted loadboard rate only; never ceiling). */
export type SafeLoad = {
  id: string;
  origin: LoadLocation;
  destination: LoadLocation;
  pickup_at: string;
  delivery_at: string;
  equipment_type: string;
  /** TMS posted RATE — safe to pitch; not MAX_BUY. */
  loadboard_rate: number;
  miles: number;
  weight: number;
  commodity: string;
  pieces: number;
  dimensions: string;
  notes: string;
};

export type SearchLoadsResponse = {
  loads: SafeLoad[];
};
