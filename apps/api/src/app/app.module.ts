import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ChecksModule } from './checks/checks.module';
import { CommonModule } from './common/common.module';
import { OriginMiddleware } from './common/origin.middleware';
import { ConfigModule } from './config/config.module';
import { EmployeesModule } from './employees/employees.module';
import { ExportsModule } from './exports/exports.module';
import { HealthController } from './health/health.controller';
import { HolidaysModule } from './holidays/holidays.module';
import { LeaveModule } from './leave/leave.module';
import { LegalModule } from './legal/legal.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { SickModule } from './sick/sick.module';
import { RemindersModule } from './reminders/reminders.module';
import { TimeModule } from './time/time.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    AuditModule,
    MailModule,
    AuthModule,
    EmployeesModule,
    HolidaysModule,
    LegalModule,
    TimeModule,
    LeaveModule,
    ChecksModule,
    ExportsModule,
    RemindersModule,
    SickModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginMiddleware).forRoutes('*path');
  }
}
