import { Global, Module } from '@nestjs/common';
import { MailService, SmtpMailService } from './mail.service';

@Global()
@Module({
  providers: [{ provide: MailService, useClass: SmtpMailService }],
  exports: [MailService],
})
export class MailModule {}
