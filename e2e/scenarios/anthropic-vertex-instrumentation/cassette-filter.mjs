// @ts-check
/** @type {import("@braintrust/seinfeld").FilterSpec} */
export const filter = [
  "default",
  {
    normalizeRequest(req) {
      const url = new URL(req.url);
      url.pathname = url.pathname.replace(
        /\/projects\/[^/]+\//,
        "/projects/cassette-project/",
      );
      return { ...req, url: url.toString() };
    },
  },
];
