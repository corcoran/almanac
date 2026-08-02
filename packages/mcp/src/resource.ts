export type Resource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<string>;
};
