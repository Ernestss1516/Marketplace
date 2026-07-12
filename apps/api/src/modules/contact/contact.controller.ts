import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { ContactReasonsService } from './contact-reasons.service';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

@ApiTags('Contacto (público)')
@Controller('contacto')
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly contactReasonsService: ContactReasonsService,
  ) {}

  @Get('token')
  getToken() {
    return this.contactService.issueToken();
  }

  /** RC.2 — puebla el <select> del formulario público: solo motivos activos,
   * ordenados. /contacto es force-dynamic (fetch de cliente, no SSR cacheable
   * por el time-trap) — sin riesgo de servir una lista de motivos obsoleta. */
  @Get('motivos')
  listMotivos() {
    return this.contactReasonsService.listActive();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  submit(@Body() dto: CreateContactMessageDto, @Ip() ip: string) {
    return this.contactService.submit(dto, ip);
  }
}
