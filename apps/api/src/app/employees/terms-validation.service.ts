import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { formatLocalDate, type LocalDate, type TermsInput } from '@as/shared';
import { validateEmploymentTerms, youthVacationError, type TermsValidation } from '@as/time-rules';
import { toLocalDate } from '../common/dates';
import { loadLegalValues } from '../legal/legal-values';
import { PrismaService } from '../prisma/prisma.service';

export const TERMS_REJECTED = 'Der Vertragsstand ist nicht zulässig.';

/**
 * Prüft einen Vertragsstand mit `validateEmploymentTerms` gegen die gesetzlichen Werte am Stichtag.
 * Fehler ergeben 422 (CLAUDE.md: Jahresurlaub unter dem Minimum lässt sich nicht speichern).
 */
@Injectable()
export class TermsValidationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Frühester Stichtag, ab dem alle gesetzlichen Werte hinterlegt sind. */
  async earliestLegalDate(): Promise<LocalDate | null> {
    const rows = await this.prisma.legalParameter.findMany({ select: { validFrom: true } });
    const dates = [...new Set(rows.map((r) => toLocalDate(r.validFrom)))].sort();
    for (const date of dates) {
      if ((await loadLegalValues(this.prisma, date)).current) return date;
    }
    return null;
  }

  /** `birthDate`: für den Jugendmindesturlaub (§ 19 Abs. 2 JArbSchG, Phase 7). */
  async validate(input: TermsInput, birthDate: LocalDate | null = null): Promise<TermsValidation> {
    const legal = await loadLegalValues(this.prisma, input.validFrom);
    if (!legal.current) {
      const text = `Für den Stichtag ${formatLocalDate(input.validFrom)} sind keine gesetzlichen Werte hinterlegt.`;
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: TERMS_REJECTED,
        errors: [{ code: 'LEGAL_VALUES_MISSING', text }],
        warnings: [],
        infos: [],
      });
    }
    const result = validateEmploymentTerms(input, legal.current, legal.upcoming);
    const youthError = youthVacationError(input, birthDate);
    if (youthError) result.errors.push(youthError);
    if (result.errors.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: TERMS_REJECTED,
        ...result,
      });
    }
    return result;
  }
}
