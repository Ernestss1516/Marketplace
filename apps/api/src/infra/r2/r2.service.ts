import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
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
}
