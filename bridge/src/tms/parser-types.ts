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
