import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../auth/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  displayName: string;

  @Column({ type: 'varchar', default: Role.User })
  role: Role;

  // Secret-bearing column: never serialise a User entity directly.
  @Column()
  passwordHash: string;
}
