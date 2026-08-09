import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class R2Service implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;
  private publicUrl!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.bucket = this.config.getOrThrow<string>('s3.bucket');
    this.publicUrl = this.config.getOrThrow<string>('s3.publicUrl').replace(/\/$/, '');
    this.client = new S3Client({
      endpoint: this.config.getOrThrow<string>('s3.endpoint'),
      region: 'auto',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('s3.accessKeyId'),
        secretAccessKey: this.config.getOrThrow<string>('s3.secretAccessKey'),
      },
      forcePathStyle: true,
    });
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
  }

  /**
   * URL PREFIRMADA de subida: el navegador sube el fichero DIRECTAMENTE al almacenamiento y
   * los bytes no pasan por esta API.
   *
   * POR QUÉ EXISTE. El camino de imágenes usa `memoryStorage()` de multer, o sea que el
   * fichero entero vive en la RAM del proceso mientras se sube. Con imágenes de 10 MB da
   * igual; con vídeos de decenas de megas, diez vendedores subiendo a la vez serían cientos
   * de megas en el mismo proceso que atiende toda la API. Aquí el API solo valida y firma.
   *
   * EL TAMAÑO VA DENTRO DE LA FIRMA (`ContentLength`), y eso es lo que convierte el límite
   * en una GARANTÍA y no en una comprobación que el cliente pueda esquivar: la firma cubre
   * ese valor, así que un PUT con un cuerpo de otro tamaño es rechazado por el propio
   * almacenamiento. No hace falta confiar en lo que el navegador declare — lo que declara es
   * justo lo que queda firmado, y se validó antes de firmarlo.
   *
   * El `ContentType` viaja igual: el objeto no puede acabar siendo otra cosa de la aceptada.
   */
  presignUpload(params: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        ContentType: params.contentType,
        ContentLength: params.contentLength,
      }),
      { expiresIn: params.expiresInSeconds },
    );
  }

  /**
   * Metadatos del objeto sin descargarlo. Se usa para CONFIRMAR lo que de verdad aterrizó:
   * la firma ya acota el tamaño, pero comprobarlo después es lo que distingue «subió algo»
   * de «subió lo que dijo», y de paso detecta la confirmación de un objeto que nunca llegó.
   */
  async head(key: string): Promise<{ contentLength: number; contentType: string | null } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentLength: res.ContentLength ?? 0,
        contentType: res.ContentType ?? null,
      };
    } catch {
      // El objeto no existe (o no es accesible): quien confirma se lo ha inventado.
      return null;
    }
  }
}
