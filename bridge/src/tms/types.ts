export type TmsCommand = "LOAD_QUERY" | "LOAD_GET" | "LOAD_BOOK";

export type LoadQueryFilters = {
  orig_state?: string;
  dest_state?: string;
  orig_city?: string;
  eqtype?: string;
  max_results?: number;
};

export type TmsWireError = {
  code: string;
  message: string;
};

export type ParsedTmsSuccess = {
  kind: "success";
  records: Map<string, string>[];
};

export type ParsedTmsFailure = {
  kind: "error";
  wire: TmsWireError;
};

export type ParsedTmsResponse = ParsedTmsSuccess | ParsedTmsFailure;
