import { Injectable } from '@angular/core';
import { Pack, PackDomain } from '../models/pack.model';
import { Question } from '../models/question.model';
import { buildBatches, slugify, todayIsoDate } from '../utils/file-splitter.util';

@Injectable({ providedIn: 'root' })
export class ExportService {
  downloadFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  buildBatches(questions: Question[], maxPerFile: number): Question[][] {
    return buildBatches(questions, maxPerFile);
  }

  buildMarkdownContent(
    batch: Question[],
    partNum: number,
    totalParts: number,
    pack: Pack,
  ): string {
    const title = pack.name ? `${pack.name} Study Notes` : 'IT Certification Study Notes';
    const partLine = totalParts > 1 ? ` — Part ${partNum} of ${totalParts}` : '';
    let md = `# ${title}${partLine}`;

    if (pack.exportIntroQuestions?.trim()) {
      md += `\n\n${pack.exportIntroQuestions.trim()}`;
    }

    const domainMap = this.groupByDomain(batch);
    const domainOrder = this.domainOrder(pack.domains, domainMap);

    for (const domainName of domainOrder) {
      const questions = domainMap.get(domainName) ?? [];
      const packDomain = pack.domains.find((d) => d.name === domainName);
      md += `\n\n---\n\n## ${domainName}`;
      if (packDomain?.description) {
        md += `\n\n${packDomain.description}`;
      }
      questions.forEach((q, i) => {
        md += `\n\n---\n\n### Question ${i + 1}\n\n${q.review.trim()}`;
      });
    }

    return `${md}\n`;
  }

  buildFilename(certName: string, suffix: string, packVersion = ''): string {
    const certSlug = certName ? slugify(certName) : '';
    const versionPart = packVersion.trim() ? `-${slugify(packVersion.trim())}` : '';
    const base = certSlug ? `${certSlug}${versionPart}` : 'study';
    return `${base}-${suffix}.md`;
  }

  buildDomainFilename(domain: PackDomain, packVersion: string): string {
    const prefix = typeof domain.order === 'number' ? `domain-${domain.order}-` : '';
    const slug = slugify(domain.name) || 'domain';
    const versionSuffix = packVersion.trim() ? `-${slugify(packVersion.trim())}` : '';
    return `${prefix}${slug}${versionSuffix}.md`;
  }

  private groupByDomain(questions: Question[]): Map<string, Question[]> {
    const map = new Map<string, Question[]>();
    for (const q of questions) {
      const key = q.domain || 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return map;
  }

  private domainOrder(packDomains: PackDomain[], present: Map<string, Question[]>): string[] {
    const ordered = packDomains.map((d) => d.name).filter((name) => present.has(name));
    for (const name of present.keys()) {
      if (!ordered.includes(name)) ordered.push(name);
    }
    return ordered;
  }
}
