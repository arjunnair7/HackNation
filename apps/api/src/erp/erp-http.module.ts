import { Module } from '@nestjs/common';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { ErpController } from './erp.controller';
import { ErpModule } from './erp.module';

@Module({
  imports: [ErpModule, GuardrailsModule],
  controllers: [ErpController],
})
export class ErpHttpModule {}
