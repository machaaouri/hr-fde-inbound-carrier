export type TmsCommand =
  | "DEBUG_ECHO"
  | "LOAD_QUERY"
  | "LOAD_GET"
  | "LOAD_BOOK";

export type LoadQueryFilters = {
  orig_state?: string;
  dest_state?: string;
  orig_city?: string;
  eqtype?: string;
  max_results?: number;
};

export type EchoResponse = {
  auth_ok: boolean;
  msg: string | null;
  fields_parsed: number | null;
};
