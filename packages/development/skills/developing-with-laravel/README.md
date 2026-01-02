# Laravel Skill

Laravel framework patterns, Eloquent ORM, and enterprise application development.

## Purpose

This skill provides Laravel-specific patterns for building modern PHP applications. It builds on the PHP skill for language fundamentals and focuses on framework-specific concepts, Eloquent ORM, authentication, queues, and Artisan CLI.

## Prerequisites

- **PHP Skill**: Required for language fundamentals (see PHP skill)
- PHP 8.2+
- Laravel 11.x / 12.x

## When to Load

- Laravel application development
- Eloquent ORM queries and relationships
- Authentication (Sanctum, Passport)
- Queue and job processing
- Artisan command development
- API development with Laravel

## Key Topics

| Topic | Description |
|-------|-------------|
| Eloquent ORM | Models, relationships, scopes, observers |
| Authentication | Sanctum, Passport, spatie/laravel-permission |
| Queues & Jobs | Job dispatch, batching, custom drivers |
| Artisan CLI | Custom commands, scheduling, long-running |
| Events & Broadcasting | Events, listeners, WebSockets (Reverb) |
| Validation | Form requests, custom rules |
| Middleware | Custom middleware patterns |
| Testing | HTTP tests, database testing, mocking |

## File Structure

```
laravel/
├── README.md           # This file
├── SKILL.md            # Quick reference (~1100 lines)
├── REFERENCE.md        # Comprehensive guide (~2000 lines)
├── VALIDATION.md       # Coverage matrix
├── templates/
│   ├── model.template.php
│   ├── controller.template.php
│   ├── migration.template.php
│   ├── form_request.template.php
│   ├── custom_rule.template.php
│   ├── policy.template.php
│   ├── job.template.php
│   ├── event.template.php
│   ├── listener.template.php
│   ├── middleware.template.php
│   ├── command.template.php
│   ├── command_consumer.template.php
│   ├── command_scheduled.template.php
│   ├── service_provider.template.php
│   ├── factory.template.php
│   ├── seeder.template.php
│   └── test.template.php
└── examples/
    ├── eloquent_patterns.example.php
    ├── api_resource.example.php
    ├── artisan_patterns.example.php
    ├── queue_workflow.example.php
    ├── permission_acl.example.php
    ├── multi_tenant.example.php
    └── passport_oauth.example.php
```

## Relationship to Other Skills

| Skill | Relationship |
|-------|--------------|
| **PHP** | Laravel skill requires PHP skill for language fundamentals |
| **Prisma** | Alternative ORM approach (TypeScript/Node.js) |
| **Celery** | Comparable queue system (Python) |

## Context7 Integration

Use Context7 for:
- Laravel package-specific documentation
- Livewire patterns
- Inertia.js integration
- Filament admin panels

## Quick Start

```php
<?php
// Eloquent Model with relationships
class Post extends Model
{
    use SoftDeletes;

    protected $fillable = ['title', 'content', 'status'];
    protected $casts = ['status' => PostStatus::class];

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function scopePublished(Builder $query): void
    {
        $query->where('status', PostStatus::Published);
    }
}

// Custom Artisan Command
class ProcessContactsCommand extends Command
{
    protected $signature = 'contacts:process {--dry-run}';
    protected $description = 'Process all contacts';

    public function handle(): int
    {
        $this->withProgressBar(Contact::cursor(), function ($contact) {
            // Process each contact
        });

        return Command::SUCCESS;
    }
}

// Job with retry
class SendWelcomeEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public array $backoff = [30, 60, 120];

    public function handle(Mailer $mailer): void
    {
        $mailer->to($this->user)->send(new WelcomeEmail($this->user));
    }
}
```

## Version

- **Skill Version**: 1.0.0
- **Laravel Version**: 11.x / 12.x
- **Last Updated**: 2025-01-01
