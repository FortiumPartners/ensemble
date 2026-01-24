import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsArray,
  IsDate,
  MinLength,
  MaxLength,
  Min,
  Max,
  IsNotEmpty,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type, Exclude, Expose } from 'class-transformer';

/**
 * DTO for creating a {{entity-display-name}}
 */
export class Create{{EntityName}}Dto {
  @ApiProperty({
    description: 'Name of the {{entity-display-name}}',
    example: 'Example Name',
    minLength: 3,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Name must be at least 3 characters long' })
  @MaxLength(100, { message: 'Name must not exceed 100 characters' })
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the {{entity-display-name}}',
    example: 'This is a detailed description',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;

  @ApiPropertyOptional({
    description: 'Status of the {{entity-display-name}}',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // Example: Email validation
  // @ApiProperty({
  //   description: 'Email address',
  //   example: 'user@example.com',
  // })
  // @IsEmail({}, { message: 'Invalid email format' })
  // @IsNotEmpty()
  // email: string;

  // Example: Number validation
  // @ApiProperty({
  //   description: 'Numeric value',
  //   example: 42,
  //   minimum: 0,
  //   maximum: 100,
  // })
  // @IsNumber()
  // @Min(0, { message: 'Value must be at least 0' })
  // @Max(100, { message: 'Value must not exceed 100' })
  // value: number;

  // Example: Enum validation
  // @ApiProperty({
  //   description: 'Status',
  //   enum: StatusEnum,
  //   example: StatusEnum.ACTIVE,
  // })
  // @IsEnum(StatusEnum, { message: 'Invalid status value' })
  // status: StatusEnum;

  // Example: Array validation
  // @ApiProperty({
  //   description: 'List of tags',
  //   type: [String],
  //   example: ['tag1', 'tag2'],
  // })
  // @IsArray()
  // @IsString({ each: true })
  // @IsOptional()
  // tags?: string[];

  // Example: Nested object validation
  // @ApiProperty({
  //   description: 'Nested object',
  //   type: NestedDto,
  // })
  // @ValidateNested()
  // @Type(() => NestedDto)
  // nested: NestedDto;

  // Example: Regex pattern validation
  // @ApiProperty({
  //   description: 'Phone number',
  //   example: '+1234567890',
  // })
  // @IsString()
  // @Matches(/^\+?[1-9]\d{1,14}$/, {
  //   message: 'Invalid phone number format',
  // })
  // phoneNumber: string;
}

/**
 * DTO for updating a {{entity-display-name}}
 * All fields are optional
 */
export class Update{{EntityName}}Dto extends PartialType(Create{{EntityName}}Dto) {}

/**
 * DTO for {{entity-display-name}} response
 * Excludes sensitive fields and includes computed properties
 */
export class {{EntityName}}ResponseDto {
  @Expose()
  @ApiProperty({
    description: '{{EntityName}} ID',
    example: 1,
  })
  id: number;

  @Expose()
  @ApiProperty({
    description: 'Name of the {{entity-display-name}}',
    example: 'Example Name',
  })
  name: string;

  @Expose()
  @ApiPropertyOptional({
    description: 'Description of the {{entity-display-name}}',
    example: 'This is a detailed description',
  })
  description?: string;

  @Expose()
  @ApiProperty({
    description: 'Status of the {{entity-display-name}}',
    example: true,
  })
  isActive: boolean;

  @Expose()
  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-01-01T00:00:00Z',
  })
  createdAt: Date;

  @Expose()
  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-01-01T00:00:00Z',
  })
  updatedAt: Date;

  @Expose()
  @ApiPropertyOptional({
    description: 'Deletion timestamp (soft delete)',
    example: null,
  })
  deletedAt?: Date;

  // Example: Exclude sensitive fields
  // @Exclude()
  // password: string;

  // @Exclude()
  // secretKey: string;

  // Example: Include related entities
  // @Expose()
  // @ApiProperty({
  //   description: 'Related entity',
  //   type: RelatedEntityResponseDto,
  // })
  // @Type(() => RelatedEntityResponseDto)
  // relatedEntity: RelatedEntityResponseDto;

  /**
   * Factory method to create response DTO from entity
   */
  static from(entity: any): {{EntityName}}ResponseDto {
    const dto = new {{EntityName}}ResponseDto();
    Object.assign(dto, entity);
    return dto;
  }
}

/**
 * DTO for paginated {{entity-display-name}} response
 */
export class Paginated{{EntityName}}ResponseDto {
  @ApiProperty({
    description: 'List of {{entity-display-name-plural}}',
    type: [{{EntityName}}ResponseDto],
  })
  data: {{EntityName}}ResponseDto[];

  @ApiProperty({
    description: 'Total number of records',
    example: 100,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of records per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 5,
  })
  totalPages: number;
}

/**
 * DTO for filtering and sorting
 */
export class Find{{EntityName}}QueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    minimum: 1,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of records per page',
    example: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Search query',
    example: 'search term',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    enum: ['name', 'createdAt', 'updatedAt'],
  })
  @IsString()
  @IsOptional()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'DESC',
    enum: ['ASC', 'DESC'],
  })
  @IsEnum(['ASC', 'DESC'])
  @IsOptional()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
