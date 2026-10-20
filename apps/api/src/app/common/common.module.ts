import { Global, Module } from '@nestjs/common';
import { Clock } from './clock';

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class CommonModule {}
