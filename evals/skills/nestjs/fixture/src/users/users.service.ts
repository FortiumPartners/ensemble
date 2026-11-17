import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findAll(): Promise<User[]> {
    return this.users.find();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }
}
