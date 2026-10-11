/** Search responses may include loadboard_rate; never ceiling or MAX_BUY. */
export function assertSafeSearchJson(json: string): void {
  if (/max_buy|maxbuy|ceiling|MAX_BUY/i.test(json)) {
    throw new Error("search response leaks ceiling");
  }
}
