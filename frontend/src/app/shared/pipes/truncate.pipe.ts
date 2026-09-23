import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'truncate',
  standalone: true,
})
export class TruncatePipe implements PipeTransform {
  transform(value: string | null | undefined, max = 80, ellipsis = '...'): string {
    if (!value) return '';
    if (value.length <= max) return value;
    const sliced = value.slice(0, Math.max(0, max - ellipsis.length));
    return `${sliced.trimEnd()}${ellipsis}`;
  }
}
