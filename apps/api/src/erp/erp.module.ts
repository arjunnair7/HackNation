import { Module } from '@nestjs/common';
import { ErpService } from './erp.service';

/** The sandbox ERP's state. Its HTTP controller lives in ErpHttpModule, next to the guardrail gate. */
@Module({
  providers: [ErpService],
  exports: [ErpService],
})
export class ErpModule {}
