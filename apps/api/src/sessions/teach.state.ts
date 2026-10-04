import { Injectable } from '@nestjs/common';

/**
 * The one active teach session. While it is set, the ERP save gate and the guardrail risk checks run
 * against its Work Map. In memory: an API restart ends training (the gate is off until the next start).
 */
@Injectable()
export class TeachState {
  activeSessionId?: string;
}
