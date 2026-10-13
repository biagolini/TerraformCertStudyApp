import { Injectable, inject } from '@angular/core';
import { Pack } from '../models/pack.model';
import { Question } from '../models/question.model';
import { BanksService } from './banks.service';
import { CatalogService } from './catalog.service';
import { NotesService } from './notes.service';
import { PacksService } from './packs.service';
import { QuestionsService } from './questions.service';
import { StorageService } from './storage.service';
import { newId } from '../utils/id.util';

const STARTER_CATALOG_ID = 'aws-saa-c03-pack';

type SampleQuestion = Omit<Question, 'id' | 'packId' | 'bankId' | 'createdAt' | 'updatedAt'>;

/** Original sample questions (written for this app) so a first-time user can
 * try the mock-exam runner, review viewer and analytics right away. */
const SAMPLE_QUESTIONS: SampleQuestion[] = [
  {
    title: 'Private S3 access from instances in private subnets',
    domain: 'Design Secure Architectures',
    language: 'en',
    stem:
      'A company runs Amazon EC2 instances in private subnets with no internet access. The instances must read objects from an Amazon S3 bucket in the same Region. Traffic must not traverse the internet and the solution must have the lowest cost. What should a solutions architect do?',
    alternatives: [
      {
        letter: 'A',
        text: 'Deploy a NAT gateway in a public subnet and route S3 traffic through it.',
        isCorrect: false,
        comment: 'A NAT gateway sends traffic to the public S3 endpoint and charges per GB processed, so it is neither private nor the cheapest option.',
      },
      {
        letter: 'B',
        text: 'Create a gateway VPC endpoint for Amazon S3 and add it to the private subnets’ route tables.',
        isCorrect: true,
        comment: 'Gateway endpoints for S3 keep traffic on the AWS network, are added as route-table targets, and have no hourly or data-processing charge.',
      },
      {
        letter: 'C',
        text: 'Attach an internet gateway to the VPC and give the instances Elastic IP addresses.',
        isCorrect: false,
        comment: 'This makes the instances reachable from the internet and sends S3 traffic over the public internet, violating both requirements.',
      },
      {
        letter: 'D',
        text: 'Set up an AWS Site-to-Site VPN to the S3 service.',
        isCorrect: false,
        comment: 'Site-to-Site VPN connects a VPC to an on-premises network; it is not a way to reach S3 privately from inside the VPC.',
      },
    ],
    generalComment: 'Remember the split: gateway endpoints exist only for S3 and DynamoDB and are free; interface endpoints (PrivateLink) cover most other services and are billed per hour and per GB.',
    metadata: { topics: ['VPC endpoints', 'Private connectivity'], relatedServices: ['Amazon S3', 'Amazon VPC'] },
  },
  {
    title: 'Surviving an Availability Zone failure for a relational database',
    domain: 'Design Resilient Architectures',
    language: 'en',
    stem:
      'An application uses a single Amazon RDS for MySQL DB instance. The business requires the database to keep running with automatic failover if an Availability Zone becomes unavailable, without application changes to the connection string. Which solution meets these requirements?',
    alternatives: [
      {
        letter: 'A',
        text: 'Create a read replica in another Availability Zone and point the application to it during an outage.',
        isCorrect: false,
        comment: 'Promoting a read replica is a manual step and gives it a new endpoint, so it fails both the automatic-failover and unchanged-endpoint requirements.',
      },
      {
        letter: 'B',
        text: 'Take automated snapshots every hour and restore them in another Availability Zone when needed.',
        isCorrect: false,
        comment: 'Restoring from a snapshot is a recovery procedure with data loss and downtime, not automatic failover.',
      },
      {
        letter: 'C',
        text: 'Modify the DB instance to a Multi-AZ deployment.',
        isCorrect: true,
        comment: 'Multi-AZ keeps a synchronous standby in another AZ and fails over automatically by repointing the same DNS endpoint, so the application keeps its connection string.',
      },
      {
        letter: 'D',
        text: 'Place the DB instance behind an Application Load Balancer that spans two Availability Zones.',
        isCorrect: false,
        comment: 'Load balancers do not front RDS instances and cannot replicate data between Availability Zones.',
      },
    ],
    generalComment: 'Multi-AZ is for availability (standby is not readable in the classic configuration); read replicas are for read scaling and can also serve cross-Region disaster recovery.',
    metadata: { topics: ['High availability', 'RDS Multi-AZ'], relatedServices: ['Amazon RDS'] },
  },
  {
    title: 'Cost-effective storage for rarely accessed data with unpredictable reads',
    domain: 'Design Cost-Optimized Architectures',
    language: 'en',
    stem:
      'A media company stores several hundred terabytes of video in Amazon S3. Most objects are not read after 30 days, but some become popular again unpredictably and must be available within milliseconds when that happens. The company wants to reduce storage costs without managing lifecycle rules per object. Which storage approach should be used? (Select TWO.)',
    alternatives: [
      {
        letter: 'A',
        text: 'Store new objects in S3 Intelligent-Tiering.',
        isCorrect: true,
        comment: 'Intelligent-Tiering moves each object between access tiers automatically based on its own access pattern, with millisecond access in the frequent and infrequent tiers.',
      },
      {
        letter: 'B',
        text: 'Transition all objects to S3 Glacier Deep Archive after 30 days.',
        isCorrect: false,
        comment: 'Deep Archive retrievals take hours, which breaks the millisecond-access requirement when an old video becomes popular again.',
      },
      {
        letter: 'C',
        text: 'Leave the archive access tiers of Intelligent-Tiering disabled.',
        isCorrect: true,
        comment: 'The optional Archive and Deep Archive Access tiers are asynchronous; keeping them off guarantees every object stays retrievable in milliseconds.',
      },
      {
        letter: 'D',
        text: 'Move the objects to an Amazon EBS Cold HDD (sc1) volume.',
        isCorrect: false,
        comment: 'EBS volumes are block storage attached to instances; they are more expensive per GB at this scale and add operational overhead.',
      },
    ],
    generalComment: 'Unknown or changing access patterns point to Intelligent-Tiering; predictable patterns point to explicit lifecycle transitions.',
    metadata: { topics: ['S3 storage classes', 'Cost optimization'], relatedServices: ['Amazon S3'] },
  },
];

const WELCOME_NOTE = `# Welcome to your study workspace

This sample certification shows how Cert Study is organized:

- **Question banks** group questions by source (a practice exam, an instructor's set, your own questions).
- **Mock exams** draw questions from one or more banks, with instant feedback or a strict final review.
- **Performance** tracks every attempt and your weak domains.
- **Notes** like this one are plain Markdown, with an AI copilot on the side.

> Key takeaway: import your own practice material from the Question banks tab, then delete this sample whenever you like.

## Next steps

- [ ] Run a 3-question mock exam in instant-feedback mode
- [ ] Ask the copilot to turn this note into flashcards
- [ ] Add your own question bank
`;

/** One-click sample data for a user with no certifications yet. */
@Injectable({ providedIn: 'root' })
export class StarterKitService {
  private readonly catalog = inject(CatalogService);
  private readonly packs = inject(PacksService);
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly notes = inject(NotesService);
  private readonly storage = inject(StorageService);

  async load(): Promise<Pack> {
    await this.catalog.load();
    const entry = this.catalog.byId().get(STARTER_CATALOG_ID);
    if (!entry) throw new Error('Starter certification is missing from the catalog.');
    const pack = this.packs.create(await this.catalog.draftFor(entry));
    const bank = this.banks.create(pack.id, {
      author: 'Cert Study',
      version: 'Sample questions',
      sourceUrl: '',
      description: 'Three original questions to try the mock-exam runner and the review viewer.',
    });
    const now = Date.now();
    SAMPLE_QUESTIONS.forEach((q, i) => {
      this.questions.add({ ...q, id: newId(), packId: pack.id, bankId: bank.id, createdAt: now - i, updatedAt: now - i });
    });
    await this.storage.flushPendingSync();
    await this.notes.create(pack.id, 'Welcome to your workspace', WELCOME_NOTE, ['getting-started']);
    return pack;
  }
}
