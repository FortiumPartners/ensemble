import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Role } from '@/common/enums/role.enum';
import { {{EntityName}}Service } from '../services/{{entity-name}}.service';
import { Create{{EntityName}}Dto } from '../dto/create-{{entity-name}}.dto';
import { Update{{EntityName}}Dto } from '../dto/update-{{entity-name}}.dto';
import { {{EntityName}}ResponseDto } from '../dto/{{entity-name}}-response.dto';
import { PaginatedResponseDto } from '@/common/dto/paginated-response.dto';
import { User } from '@/modules/users/entities/user.entity';

@ApiTags('{{entity-name-plural}}')
@Controller('{{endpoint-path}}')
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@ApiBearerAuth()
export class {{EntityName}}Controller {
  constructor(private readonly {{entityName}}Service: {{EntityName}}Service) {}

  /**
   * Create a new {{entity-display-name}}
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new {{entity-display-name}}' })
  @ApiResponse({
    status: 201,
    description: '{{EntityName}} created successfully',
    type: {{EntityName}}ResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: '{{EntityName}} already exists' })
  async create(
    @Body(ValidationPipe) createDto: Create{{EntityName}}Dto,
    @CurrentUser() user: User,
  ): Promise<{{EntityName}}ResponseDto> {
    const {{entityName}} = await this.{{entityName}}Service.create(createDto, user);
    return {{EntityName}}ResponseDto.from({{entityName}});
  }

  /**
   * Get all {{entity-display-name-plural}} with pagination
   */
  @Get()
  @ApiOperation({ summary: 'List {{entity-display-name-plural}} with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'sortBy', required: false, type: String, example: 'createdAt' })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'], example: 'DESC' })
  @ApiResponse({
    status: 200,
    description: 'List of {{entity-display-name-plural}}',
    type: PaginatedResponseDto,
  })
  async findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('search') search?: string,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'DESC',
  ): Promise<PaginatedResponseDto<{{EntityName}}ResponseDto>> {
    const result = await this.{{entityName}}Service.findAll({
      page,
      limit,
      search,
      sortBy,
      sortOrder,
    });

    return {
      data: result.data.map(item => {{EntityName}}ResponseDto.from(item)),
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    };
  }

  /**
   * Get {{entity-display-name}} by ID
   */
  @Get(':id')
  @ApiParam({ name: 'id', description: '{{EntityName}} ID', type: Number })
  @ApiOperation({ summary: 'Get {{entity-display-name}} by ID' })
  @ApiResponse({
    status: 200,
    description: '{{EntityName}} found',
    type: {{EntityName}}ResponseDto,
  })
  @ApiResponse({ status: 404, description: '{{EntityName}} not found' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{{EntityName}}ResponseDto> {
    const {{entityName}} = await this.{{entityName}}Service.findById(id);
    return {{EntityName}}ResponseDto.from({{entityName}});
  }

  /**
   * Update {{entity-display-name}}
   */
  @Patch(':id')
  @ApiParam({ name: 'id', description: '{{EntityName}} ID', type: Number })
  @ApiOperation({ summary: 'Update {{entity-display-name}}' })
  @ApiResponse({
    status: 200,
    description: '{{EntityName}} updated successfully',
    type: {{EntityName}}ResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 404, description: '{{EntityName}} not found' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(ValidationPipe) updateDto: Update{{EntityName}}Dto,
    @CurrentUser() user: User,
  ): Promise<{{EntityName}}ResponseDto> {
    const {{entityName}} = await this.{{entityName}}Service.update(id, updateDto, user);
    return {{EntityName}}ResponseDto.from({{entityName}});
  }

  /**
   * Delete {{entity-display-name}} (Admin only)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiParam({ name: 'id', description: '{{EntityName}} ID', type: Number })
  @ApiOperation({ summary: 'Delete {{entity-display-name}} (Admin only)' })
  @ApiResponse({ status: 204, description: '{{EntityName}} deleted successfully' })
  @ApiResponse({ status: 404, description: '{{EntityName}} not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.{{entityName}}Service.delete(id);
  }
}
