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
