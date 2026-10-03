import { parseQuestionReview } from './question-parse.util';

const SINGLE_ANSWER_REVIEW = `#### Key concepts related to this question:
- Multi-AZ high availability
- Application Load Balancer

#### Question Context:
Checks whether the candidate can design for automatic recovery from a full AZ outage.

#### Question:
A company runs a three-tier web application across two Availability Zones. Which change makes failover automatic?

#### Alternatives:
*A. Deploy the application in a single, larger Availability Zone*

*B. Place an Application Load Balancer in front of instances spread across both Availability Zones, in an Auto Scaling group*

*C. Take a manual snapshot of the instances every night*

#### Correct answer and explanation:
*B. Place an Application Load Balancer in front of instances spread across both Availability Zones, in an Auto Scaling group*

An Application Load Balancer spanning both zones, paired with an Auto Scaling group, reroutes traffic automatically.

#### Incorrect answers and justifications:
*A. Deploy the application in a single, larger Availability Zone*

- **Why it is incorrect**: A single AZ has no automatic failover if that zone goes down.

*C. Take a manual snapshot of the instances every night*

- **Why it is incorrect**: A manual snapshot requires human intervention to restore.
`;

const MULTI_ANSWER_REVIEW = `#### Question:
Select TWO services that provide object storage.

#### Alternatives:
*A. Amazon S3*

*B. Amazon EBS*

*C. Amazon S3 Glacier*

*D. Amazon RDS*

#### Correct answer and explanation:
*A. Amazon S3*

S3 is durable object storage.

*C. Amazon S3 Glacier*

Glacier is low-cost archival object storage.

#### Incorrect answers and justifications:
*B. Amazon EBS*

- **Why it is incorrect**: EBS is block storage, not object storage.

*D. Amazon RDS*

- **Why it is incorrect**: RDS is a managed relational database, not object storage.
`;

const TRANSLATED_REVIEW = `#### Question:
A company needs low-latency access to a small, rarely-changing config file. Which option fits best?
*Translation: Uma empresa precisa de acesso de baixa latência a um pequeno arquivo de configuração que muda raramente. Qual opção é a melhor?*

#### Alternatives:
*A. In-memory cache loaded at startup*
*Translation: Cache em memória carregado na inicialização*

*B. Relational database with hourly backups*
*Translation: Banco de dados relacional com backups a cada hora*

#### Correct answer and explanation:
*A. In-memory cache loaded at startup*

Lowest latency for small, rarely-changing data.

#### Incorrect answers and justifications:
*B. Relational database with hourly backups*

- **Why it is incorrect**: Adds unnecessary overhead and latency.
`;

const MALFORMED_REVIEW = `Just some free-form pasted text with no headings at all.
It does not follow the expected review template.`;

// Real shape found in production data: an older prompt version generated Portuguese
// headings with ### (not the current English #### template), added *Tradução:* lines
// (not *Translation:*), and appended a "---" + Sources block after the last section.
const LEGACY_PT_REVIEW = `### Conceitos-chave relacionados à pergunta:
- Trusted Identity Propagation
- IAM Identity Center

### Contextualização da Questão:
Esta questão avalia autenticação federada.

### Enunciado da questão:
A developer is building a custom web application. Which implementation is correct?
*Tradução: Um desenvolvedor está construindo uma aplicação web. Qual implementação está correta?*

### Alternativas:
*A. Use AssumeRoleWithSAML directly.*
*Tradução: Use AssumeRoleWithSAML diretamente.*

*B. Use CreateTokenWithIAM and AssumeRole with sts:identity_context.*
*Tradução: Use CreateTokenWithIAM e AssumeRole com sts:identity_context.*

### Resposta correta e explicação geral:
*B. Use CreateTokenWithIAM and AssumeRole with sts:identity_context.*
*Tradução: Use CreateTokenWithIAM e AssumeRole com sts:identity_context.*

Essa alternativa implementa corretamente a propagação de identidade.

### Respostas incorretas e justificativas:

*A. Use AssumeRoleWithSAML directly.*
*Tradução: Use AssumeRoleWithSAML diretamente.*

- **Por que está incorreta**: produz uma sessão de IAM role comum, sem o contexto de identidade.

---

Sources:
- [Some reference](https://example.com)
`;

describe('parseQuestionReview', () => {
  it('parses a standard single-answer review into one alternative per option', () => {
    const result = parseQuestionReview(SINGLE_ANSWER_REVIEW);
    expect(result).not.toBeNull();
    expect(result!.stem).toContain('three-tier web application');
    expect(result!.topics).toEqual(['Multi-AZ high availability', 'Application Load Balancer']);
    expect(result!.alternatives.map((a) => a.letter)).toEqual(['A', 'B', 'C']);
    expect(result!.alternatives.map((a) => a.isCorrect)).toEqual([false, true, false]);
    const correct = result!.alternatives.find((a) => a.letter === 'B')!;
    expect(correct.comment).toContain('Application Load Balancer spanning both zones');
    const incorrectA = result!.alternatives.find((a) => a.letter === 'A')!;
    expect(incorrectA.comment).toContain('no automatic failover');
  });

  it('parses a multi-answer ("select two") review with a comment per correct option', () => {
    const result = parseQuestionReview(MULTI_ANSWER_REVIEW);
    expect(result).not.toBeNull();
    expect(result!.alternatives).toHaveLength(4);
    const correctLetters = result!.alternatives.filter((a) => a.isCorrect).map((a) => a.letter);
    expect(correctLetters).toEqual(['A', 'C']);
    expect(result!.alternatives.find((a) => a.letter === 'A')!.comment).toContain('durable object storage');
    expect(result!.alternatives.find((a) => a.letter === 'C')!.comment).toContain('archival object storage');
  });

  it('parses the translated/bilingual output format, dropping *Translation:* lines', () => {
    const result = parseQuestionReview(TRANSLATED_REVIEW);
    expect(result).not.toBeNull();
    expect(result!.stem).not.toContain('Translation');
    expect(result!.stem).toContain('low-latency access');
    expect(result!.alternatives.map((a) => ({ letter: a.letter, text: a.text }))).toEqual([
      { letter: 'A', text: 'In-memory cache loaded at startup' },
      { letter: 'B', text: 'Relational database with hourly backups' },
    ]);
    expect(result!.alternatives.find((a) => a.letter === 'A')!.isCorrect).toBe(true);
  });

  it('parses the legacy Portuguese ###-heading format found in production data', () => {
    const result = parseQuestionReview(LEGACY_PT_REVIEW);
    expect(result).not.toBeNull();
    expect(result!.stem).not.toContain('Tradução');
    expect(result!.topics).toEqual(['Trusted Identity Propagation', 'IAM Identity Center']);
    expect(result!.alternatives.map((a) => a.letter)).toEqual(['A', 'B']);
    expect(result!.alternatives.find((a) => a.letter === 'B')!.isCorrect).toBe(true);
    expect(result!.alternatives.find((a) => a.letter === 'B')!.comment).not.toContain('Tradução');
    expect(result!.alternatives.find((a) => a.letter === 'B')!.comment).toContain('propagação de identidade');
    expect(result!.alternatives.find((a) => a.letter === 'A')!.comment).toContain('sessão de IAM role comum');
  });

  it('returns null for a review that does not follow the expected template', () => {
    expect(parseQuestionReview(MALFORMED_REVIEW)).toBeNull();
  });

  it('returns null when fewer than two alternatives are found', () => {
    const review = `#### Question:\nSome question?\n\n#### Alternatives:\n*A. Only one option*\n\n#### Correct answer and explanation:\n*A. Only one option*\n\nExplanation.`;
    expect(parseQuestionReview(review)).toBeNull();
  });
});
