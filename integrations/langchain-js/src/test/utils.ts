import { bypass, HttpResponse, JsonBodyType } from "msw";

// comment out process.env overriding in setup.ts for this to be helpful
export const bypassAndLog = async (request: Request) => {
  const res = await fetch(bypass(request));

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const json = (await res.json()) as JsonBodyType;

  console.log(request.method, request.url, JSON.stringify(json, null, 2));

  return HttpResponse.json(json);
};
