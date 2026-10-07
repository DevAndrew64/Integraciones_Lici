import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

const f = createUploadthing();

export const ourFileRouter = {
  documentoPDF: f({ pdf: { maxFileSize: '128MB' } })
    .middleware(async ({ req }) => {
      // Requiere sesión — middleware era anónimo (hallazgo alto A-4)
      // UploadThing pasa Request estándar; lo envolvemos para reutilizar getSession
      const session = await getSession(new NextRequest(req as unknown as Request));
      if (!session) throw new Error('No autenticado. Inicia sesión para subir archivos.');
      return { userId: session.id };
    })
    .onUploadComplete(async ({ file }) => {
      return { url: file.ufsUrl, name: file.name, key: file.key };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;