import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinTable,
  JoinColumn,
} from 'typeorm';
import { User } from '@/modules/users/entities/user.entity';

@Entity('{{table-name}}')
@Index(['name']) // Add indexes for frequently queried fields
export class {{EntityName}} {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  @Index() // Index for search optimization
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: true })
  isActive: boolean;

  // Example: Enum column
  // @Column({
  //   type: 'enum',
  //   enum: StatusEnum,
  //   default: StatusEnum.ACTIVE,
  // })
  // status: StatusEnum;

  // Example: Number column
  // @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  // value: number;

  // Example: JSON column
  // @Column({ type: 'json', nullable: true })
  // metadata: Record<string, any>;

  // Example: Array column
  // @Column({ type: 'simple-array', nullable: true })
  // tags: string[];

  // Relationship: Many-to-One (this entity belongs to User)
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @Column({ name: 'created_by_id', nullable: true })
  createdById: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by_id' })
  updatedBy: User;

  @Column({ name: 'updated_by_id', nullable: true })
  updatedById: number;

  // Example: One-to-Many relationship
  // @OneToMany(() => RelatedEntity, (related) => related.{{entityName}})
  // relatedEntities: RelatedEntity[];

  // Example: Many-to-Many relationship
  // @ManyToMany(() => Tag)
  // @JoinTable({
  //   name: '{{table-name}}_tags',
  //   joinColumn: { name: '{{entity-name}}_id', referencedColumnName: 'id' },
  //   inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  // })
  // tags: Tag[];

  // Timestamps
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date;

  // Example: Composite unique constraint
  // @Index(['field1', 'field2'], { unique: true })

  // Example: Custom column transformer
  // @Column({
  //   type: 'varchar',
  //   transformer: {
  //     to: (value: string) => value.toLowerCase(),
  //     from: (value: string) => value,
  //   },
  // })
  // email: string;
}
