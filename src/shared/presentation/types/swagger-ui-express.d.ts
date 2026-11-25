// swagger-ui-express no trae tipos y no se agrega @types solo por esto: se declara lo que usa
// config/swagger.{admin,client}.ts (HTML con el spec embebido + assets atados a ese spec).

declare module 'swagger-ui-express' {
  import type { RequestHandler } from 'express';

  export function generateHTML(spec: object, options?: object): string;
  export function serveFiles(spec: object, options?: object): RequestHandler[];
}
