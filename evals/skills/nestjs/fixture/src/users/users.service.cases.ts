// Named *.cases.ts (the package's jest testRegex includes it) so the repository's own jest run does not pick up fixture tests.
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';

describe('UsersService', () => {
  const repo = { find: jest.fn(), findOne: jest.fn() };
  let service: UsersService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: getRepositoryToken(User), useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('returns every user from the repository', async () => {
    repo.find.mockResolvedValue([{ id: 'u1', email: 'a@example.com' }]);
    await expect(service.findAll()).resolves.toHaveLength(1);
  });

  it('looks a user up by id', async () => {
    repo.findOne.mockResolvedValue({ id: 'u1' });
    const found = await service.findById('u1');
    expect(found).toEqual({ id: 'u1' });
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });
});
