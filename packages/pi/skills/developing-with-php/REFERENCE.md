# PHP Reference - Comprehensive Guide

Advanced PHP patterns, design patterns, and production-ready implementations.

---

## §1. Advanced OOP Concepts

### Interface Segregation

```php
<?php
// Bad: Fat interface
interface UserInterface {
    public function create(array $data): User;
    public function update(int $id, array $data): User;
    public function delete(int $id): void;
    public function sendEmail(string $to, string $subject): void;
    public function generateReport(): string;
}

// Good: Segregated interfaces
interface CreatableInterface {
    public function create(array $data): object;
}

interface UpdatableInterface {
    public function update(int $id, array $data): object;
}

interface DeletableInterface {
    public function delete(int $id): void;
}

interface CRUDInterface extends CreatableInterface, UpdatableInterface, DeletableInterface {
    public function find(int $id): ?object;
}

class UserRepository implements CRUDInterface {
    // Only implement CRUD methods
}
```

### Dependency Injection

```php
<?php
// Constructor injection (preferred)
class UserService {
    public function __construct(
        private readonly UserRepositoryInterface $repository,
        private readonly CacheInterface $cache,
        private readonly LoggerInterface $logger,
    ) {}

    public function find(int $id): ?User {
        $cacheKey = "user:{$id}";

        if ($cached = $this->cache->get($cacheKey)) {
            return $cached;
        }

        $user = $this->repository->find($id);

        if ($user) {
            $this->cache->set($cacheKey, $user, 3600);
        }

        return $user;
    }
}

// Method injection (for optional dependencies)
class ReportGenerator {
    public function generate(DataSourceInterface $source): Report {
        $data = $source->getData();
        return new Report($data);
    }
}

// Interface injection
interface LoggerAwareInterface {
    public function setLogger(LoggerInterface $logger): void;
}

trait LoggerAwareTrait {
    protected ?LoggerInterface $logger = null;

    public function setLogger(LoggerInterface $logger): void {
        $this->logger = $logger;
    }

    protected function log(string $message, array $context = []): void {
        $this->logger?->info($message, $context);
    }
}
```

### Simple DI Container

```php
<?php
class Container {
    private array $bindings = [];
    private array $singletons = [];
    private array $instances = [];

    public function bind(string $abstract, callable $concrete): void {
        $this->bindings[$abstract] = $concrete;
    }

    public function singleton(string $abstract, callable $concrete): void {
        $this->singletons[$abstract] = $concrete;
    }

    public function instance(string $abstract, object $instance): void {
        $this->instances[$abstract] = $instance;
    }

    public function make(string $abstract): object {
        // Return existing instance
        if (isset($this->instances[$abstract])) {
            return $this->instances[$abstract];
        }

        // Create singleton
        if (isset($this->singletons[$abstract])) {
            $this->instances[$abstract] = ($this->singletons[$abstract])($this);
            return $this->instances[$abstract];
        }

        // Create new instance
        if (isset($this->bindings[$abstract])) {
            return ($this->bindings[$abstract])($this);
        }

        // Auto-resolve
        return $this->resolve($abstract);
    }

    private function resolve(string $class): object {
        $reflection = new ReflectionClass($class);
        $constructor = $reflection->getConstructor();

        if (!$constructor) {
            return new $class();
        }

        $params = [];
        foreach ($constructor->getParameters() as $param) {
            $type = $param->getType();

            if ($type instanceof ReflectionNamedType && !$type->isBuiltin()) {
                $params[] = $this->make($type->getName());
            } elseif ($param->isDefaultValueAvailable()) {
                $params[] = $param->getDefaultValue();
            } else {
                throw new RuntimeException("Cannot resolve parameter: {$param->getName()}");
            }
        }

        return $reflection->newInstanceArgs($params);
    }
}

// Usage
$container = new Container();

$container->singleton(PDO::class, fn() => new PDO(
    'mysql:host=localhost;dbname=app',
    'user',
    'pass'
));

$container->bind(UserRepositoryInterface::class, fn($c) =>
    new UserRepository($c->make(PDO::class))
);

$service = $container->make(UserService::class);
```

---

## §2. Design Patterns

### Repository Pattern

```php
<?php
interface RepositoryInterface {
    public function find(int $id): ?object;
    public function findBy(array $criteria): array;
    public function findOneBy(array $criteria): ?object;
    public function findAll(): array;
    public function save(object $entity): void;
    public function delete(object $entity): void;
}

abstract class AbstractRepository implements RepositoryInterface {
    protected string $table;
    protected string $entityClass;

    public function __construct(
        protected readonly PDO $db
    ) {}

    public function find(int $id): ?object {
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->table} WHERE id = ?"
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ? $this->hydrate($row) : null;
    }

    public function findBy(array $criteria): array {
        [$where, $params] = $this->buildWhere($criteria);
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->table} {$where}"
        );
        $stmt->execute($params);

        return array_map(
            fn($row) => $this->hydrate($row),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    public function findOneBy(array $criteria): ?object {
        $results = $this->findBy($criteria);
        return $results[0] ?? null;
    }

    public function findAll(): array {
        $stmt = $this->db->query("SELECT * FROM {$this->table}");
        return array_map(
            fn($row) => $this->hydrate($row),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    abstract protected function hydrate(array $row): object;

    protected function buildWhere(array $criteria): array {
        if (empty($criteria)) {
            return ['', []];
        }

        $conditions = [];
        $params = [];
        foreach ($criteria as $column => $value) {
            $conditions[] = "{$column} = ?";
            $params[] = $value;
        }

        return ['WHERE ' . implode(' AND ', $conditions), $params];
    }
}

class UserRepository extends AbstractRepository {
    protected string $table = 'users';
    protected string $entityClass = User::class;

    protected function hydrate(array $row): User {
        return new User(
            id: (int) $row['id'],
            name: $row['name'],
            email: $row['email'],
            active: (bool) $row['active'],
        );
    }

    public function save(object $entity): void {
        if ($entity->id) {
            $this->update($entity);
        } else {
            $this->insert($entity);
        }
    }

    private function insert(User $user): void {
        $stmt = $this->db->prepare(
            'INSERT INTO users (name, email, active) VALUES (?, ?, ?)'
        );
        $stmt->execute([$user->name, $user->email, $user->active]);
        $user->id = (int) $this->db->lastInsertId();
    }

    private function update(User $user): void {
        $stmt = $this->db->prepare(
            'UPDATE users SET name = ?, email = ?, active = ? WHERE id = ?'
        );
        $stmt->execute([$user->name, $user->email, $user->active, $user->id]);
    }

    public function delete(object $entity): void {
        $stmt = $this->db->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$entity->id]);
    }

    // Custom repository methods
    public function findByEmail(string $email): ?User {
        return $this->findOneBy(['email' => $email]);
    }

    public function findActive(): array {
        return $this->findBy(['active' => 1]);
    }
}
```

### Factory Pattern

```php
<?php
interface NotificationInterface {
    public function send(string $recipient, string $message): bool;
}

class EmailNotification implements NotificationInterface {
    public function send(string $recipient, string $message): bool {
        // Send email
        return mail($recipient, 'Notification', $message);
    }
}

class SmsNotification implements NotificationInterface {
    public function send(string $recipient, string $message): bool {
        // Send SMS via API
        return true;
    }
}

class PushNotification implements NotificationInterface {
    public function send(string $recipient, string $message): bool {
        // Send push notification
        return true;
    }
}

// Simple factory
class NotificationFactory {
    public static function create(string $type): NotificationInterface {
        return match($type) {
            'email' => new EmailNotification(),
            'sms' => new SmsNotification(),
            'push' => new PushNotification(),
            default => throw new InvalidArgumentException("Unknown type: {$type}"),
        };
    }
}

// Factory with DI
class NotificationFactory {
    public function __construct(
        private readonly array $config
    ) {}

    public function create(string $type): NotificationInterface {
        return match($type) {
            'email' => new EmailNotification($this->config['smtp']),
            'sms' => new SmsNotification($this->config['twilio']),
            'push' => new PushNotification($this->config['firebase']),
            default => throw new InvalidArgumentException("Unknown type: {$type}"),
        };
    }
}
```

### Strategy Pattern

```php
<?php
interface PricingStrategyInterface {
    public function calculate(float $basePrice, array $context): float;
}

class RegularPricing implements PricingStrategyInterface {
    public function calculate(float $basePrice, array $context): float {
        return $basePrice;
    }
}

class MemberPricing implements PricingStrategyInterface {
    public function calculate(float $basePrice, array $context): float {
        return $basePrice * 0.9; // 10% discount
    }
}

class VIPPricing implements PricingStrategyInterface {
    public function calculate(float $basePrice, array $context): float {
        return $basePrice * 0.8; // 20% discount
    }
}

class BulkPricing implements PricingStrategyInterface {
    public function calculate(float $basePrice, array $context): float {
        $quantity = $context['quantity'] ?? 1;
        $discount = match(true) {
            $quantity >= 100 => 0.7,
            $quantity >= 50 => 0.8,
            $quantity >= 10 => 0.9,
            default => 1.0,
        };
        return $basePrice * $discount;
    }
}

class PriceCalculator {
    public function __construct(
        private PricingStrategyInterface $strategy
    ) {}

    public function setStrategy(PricingStrategyInterface $strategy): void {
        $this->strategy = $strategy;
    }

    public function calculate(float $basePrice, array $context = []): float {
        return $this->strategy->calculate($basePrice, $context);
    }
}

// Usage
$calculator = new PriceCalculator(new RegularPricing());
$price = $calculator->calculate(100.00);  // 100.00

$calculator->setStrategy(new VIPPricing());
$price = $calculator->calculate(100.00);  // 80.00

$calculator->setStrategy(new BulkPricing());
$price = $calculator->calculate(100.00, ['quantity' => 50]);  // 80.00
```

### Observer Pattern

```php
<?php
interface ObserverInterface {
    public function update(object $event): void;
}

interface SubjectInterface {
    public function attach(ObserverInterface $observer): void;
    public function detach(ObserverInterface $observer): void;
    public function notify(object $event): void;
}

class EventDispatcher implements SubjectInterface {
    /** @var array<string, ObserverInterface[]> */
    private array $observers = [];

    public function attach(ObserverInterface $observer, string $event = '*'): void {
        $this->observers[$event][] = $observer;
    }

    public function detach(ObserverInterface $observer): void {
        foreach ($this->observers as $event => $observers) {
            $this->observers[$event] = array_filter(
                $observers,
                fn($o) => $o !== $observer
            );
        }
    }

    public function notify(object $event): void {
        $eventClass = get_class($event);

        // Notify specific observers
        foreach ($this->observers[$eventClass] ?? [] as $observer) {
            $observer->update($event);
        }

        // Notify global observers
        foreach ($this->observers['*'] ?? [] as $observer) {
            $observer->update($event);
        }
    }
}

// Events
readonly class UserCreatedEvent {
    public function __construct(
        public User $user,
        public DateTimeImmutable $createdAt = new DateTimeImmutable(),
    ) {}
}

// Observers
class SendWelcomeEmailObserver implements ObserverInterface {
    public function update(object $event): void {
        if ($event instanceof UserCreatedEvent) {
            // Send welcome email to $event->user
        }
    }
}

class LogUserCreationObserver implements ObserverInterface {
    public function __construct(
        private readonly LoggerInterface $logger
    ) {}

    public function update(object $event): void {
        if ($event instanceof UserCreatedEvent) {
            $this->logger->info('User created', ['id' => $event->user->id]);
        }
    }
}

// Usage
$dispatcher = new EventDispatcher();
$dispatcher->attach(new SendWelcomeEmailObserver(), UserCreatedEvent::class);
$dispatcher->attach(new LogUserCreationObserver($logger), UserCreatedEvent::class);

$user = new User(id: 1, name: 'John');
$dispatcher->notify(new UserCreatedEvent($user));
```

### Singleton Pattern

```php
<?php
// Note: Use sparingly - prefer DI container singletons

trait SingletonTrait {
    private static ?self $instance = null;

    private function __construct() {}
    private function __clone() {}
    public function __wakeup() {
        throw new Exception('Cannot unserialize singleton');
    }

    public static function getInstance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }
}

class Logger {
    use SingletonTrait;

    private array $logs = [];

    public function log(string $message): void {
        $this->logs[] = [
            'message' => $message,
            'time' => date('Y-m-d H:i:s'),
        ];
    }

    public function getLogs(): array {
        return $this->logs;
    }
}

// Better alternative: DI container singleton
$container->singleton(Logger::class, fn() => new Logger());
```

### Decorator Pattern

```php
<?php
interface CacheInterface {
    public function get(string $key): mixed;
    public function set(string $key, mixed $value, int $ttl = 3600): void;
}

class RedisCache implements CacheInterface {
    public function get(string $key): mixed {
        // Redis implementation
    }

    public function set(string $key, mixed $value, int $ttl = 3600): void {
        // Redis implementation
    }
}

// Decorator: Add logging
class LoggingCacheDecorator implements CacheInterface {
    public function __construct(
        private readonly CacheInterface $cache,
        private readonly LoggerInterface $logger,
    ) {}

    public function get(string $key): mixed {
        $this->logger->debug("Cache get: {$key}");
        $value = $this->cache->get($key);
        $this->logger->debug("Cache " . ($value !== null ? "hit" : "miss") . ": {$key}");
        return $value;
    }

    public function set(string $key, mixed $value, int $ttl = 3600): void {
        $this->logger->debug("Cache set: {$key}");
        $this->cache->set($key, $value, $ttl);
    }
}

// Decorator: Add metrics
class MetricsCacheDecorator implements CacheInterface {
    private int $hits = 0;
    private int $misses = 0;

    public function __construct(
        private readonly CacheInterface $cache,
    ) {}

    public function get(string $key): mixed {
        $value = $this->cache->get($key);
        $value !== null ? $this->hits++ : $this->misses++;
        return $value;
    }

    public function set(string $key, mixed $value, int $ttl = 3600): void {
        $this->cache->set($key, $value, $ttl);
    }

    public function getStats(): array {
        return [
            'hits' => $this->hits,
            'misses' => $this->misses,
            'ratio' => $this->hits / max(1, $this->hits + $this->misses),
        ];
    }
}

// Composing decorators
$cache = new RedisCache();
$cache = new LoggingCacheDecorator($cache, $logger);
$cache = new MetricsCacheDecorator($cache);
```

---

## §3. Handler Architecture

### Layered Handler Pattern (VFM Style)

```php
<?php
// Base interfaces
interface HandlerInterface {
    public function handle(array $data): mixed;
}

interface GetHandlerInterface {
    public function get(int $id): ?array;
    public function getAll(array $filters = []): array;
}

interface SaveHandlerInterface {
    public function save(array $data): int;
    public function update(int $id, array $data): bool;
}

interface DeleteHandlerInterface {
    public function delete(int $id): bool;
    public function softDelete(int $id): bool;
}

// Aggregated CRUD Handler
abstract class CRUDHandler implements GetHandlerInterface, SaveHandlerInterface, DeleteHandlerInterface {
    protected string $table;
    protected array $fillable = [];
    protected bool $softDeletes = false;

    public function __construct(
        protected readonly PDO $db,
        protected readonly ?CacheInterface $cache = null,
    ) {}

    public function get(int $id): ?array {
        $cacheKey = "{$this->table}:{$id}";

        if ($this->cache && $cached = $this->cache->get($cacheKey)) {
            return $cached;
        }

        $sql = "SELECT * FROM {$this->table} WHERE id = ?";
        if ($this->softDeletes) {
            $sql .= " AND deleted_at IS NULL";
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute([$id]);
        $result = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;

        if ($result && $this->cache) {
            $this->cache->set($cacheKey, $result, 3600);
        }

        return $result;
    }

    public function getAll(array $filters = []): array {
        $sql = "SELECT * FROM {$this->table}";
        $params = [];

        $conditions = [];
        if ($this->softDeletes) {
            $conditions[] = "deleted_at IS NULL";
        }

        foreach ($filters as $column => $value) {
            if (in_array($column, $this->fillable)) {
                $conditions[] = "{$column} = ?";
                $params[] = $value;
            }
        }

        if (!empty($conditions)) {
            $sql .= " WHERE " . implode(" AND ", $conditions);
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function save(array $data): int {
        $filtered = $this->filterFillable($data);
        $columns = implode(', ', array_keys($filtered));
        $placeholders = implode(', ', array_fill(0, count($filtered), '?'));

        $stmt = $this->db->prepare(
            "INSERT INTO {$this->table} ({$columns}) VALUES ({$placeholders})"
        );
        $stmt->execute(array_values($filtered));

        $id = (int) $this->db->lastInsertId();
        $this->invalidateCache($id);

        return $id;
    }

    public function update(int $id, array $data): bool {
        $filtered = $this->filterFillable($data);
        $sets = implode(', ', array_map(fn($col) => "{$col} = ?", array_keys($filtered)));

        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET {$sets}, updated_at = NOW() WHERE id = ?"
        );
        $result = $stmt->execute([...array_values($filtered), $id]);

        $this->invalidateCache($id);

        return $result;
    }

    public function delete(int $id): bool {
        $stmt = $this->db->prepare("DELETE FROM {$this->table} WHERE id = ?");
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }

    public function softDelete(int $id): bool {
        $stmt = $this->db->prepare(
            "UPDATE {$this->table} SET deleted_at = NOW() WHERE id = ?"
        );
        $result = $stmt->execute([$id]);
        $this->invalidateCache($id);
        return $result;
    }

    protected function filterFillable(array $data): array {
        return array_intersect_key($data, array_flip($this->fillable));
    }

    protected function invalidateCache(int $id): void {
        $this->cache?->delete("{$this->table}:{$id}");
    }
}

// Specialized handler with additional methods
class ContactHandler extends CRUDHandler {
    protected string $table = 'contacts';
    protected array $fillable = ['first_name', 'last_name', 'email', 'phone', 'company'];
    protected bool $softDeletes = true;

    public function search(string $query): array {
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->table}
             WHERE deleted_at IS NULL
             AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)
             LIMIT 50"
        );
        $like = "%{$query}%";
        $stmt->execute([$like, $like, $like]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function findByEmail(string $email): ?array {
        $stmt = $this->db->prepare(
            "SELECT * FROM {$this->table} WHERE email = ? AND deleted_at IS NULL"
        );
        $stmt->execute([$email]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public function getWithTags(int $id): ?array {
        $contact = $this->get($id);
        if (!$contact) {
            return null;
        }

        $stmt = $this->db->prepare(
            "SELECT t.* FROM tags t
             JOIN contact_tags ct ON ct.tag_id = t.id
             WHERE ct.contact_id = ?"
        );
        $stmt->execute([$id]);
        $contact['tags'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

        return $contact;
    }
}
```

### Handler with Transaction Support

```php
<?php
trait TransactionTrait {
    protected function transaction(callable $callback): mixed {
        try {
            $this->db->beginTransaction();
            $result = $callback();
            $this->db->commit();
            return $result;
        } catch (Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }
}

class OrderHandler extends CRUDHandler {
    use TransactionTrait;

    protected string $table = 'orders';
    protected array $fillable = ['user_id', 'status', 'total'];

    public function createWithItems(array $orderData, array $items): int {
        return $this->transaction(function() use ($orderData, $items) {
            // Create order
            $orderId = $this->save($orderData);

            // Create order items
            $itemStmt = $this->db->prepare(
                "INSERT INTO order_items (order_id, product_id, quantity, price)
                 VALUES (?, ?, ?, ?)"
            );

            // Update stock
            $stockStmt = $this->db->prepare(
                "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?"
            );

            foreach ($items as $item) {
                $itemStmt->execute([
                    $orderId,
                    $item['product_id'],
                    $item['quantity'],
                    $item['price'],
                ]);

                $stockStmt->execute([
                    $item['quantity'],
                    $item['product_id'],
                    $item['quantity'],
                ]);

                if ($stockStmt->rowCount() === 0) {
                    throw new InsufficientStockException(
                        "Insufficient stock for product: {$item['product_id']}"
                    );
                }
            }

            return $orderId;
        });
    }
}
```

---

## §4. Performance Optimization

### Batch Processing

```php
<?php
class BatchProcessor {
    public function __construct(
        private readonly PDO $db,
        private readonly int $batchSize = 1000,
    ) {}

    public function processCursor(string $sql, callable $callback): int {
        $stmt = $this->db->prepare($sql);
        $stmt->execute();

        $processed = 0;
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $callback($row);
            $processed++;

            if ($processed % $this->batchSize === 0) {
                gc_collect_cycles();  // Memory management
            }
        }

        return $processed;
    }

    public function processBatched(string $table, callable $callback): int {
        $lastId = 0;
        $processed = 0;

        do {
            $stmt = $this->db->prepare(
                "SELECT * FROM {$table} WHERE id > ? ORDER BY id LIMIT ?"
            );
            $stmt->execute([$lastId, $this->batchSize]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($rows as $row) {
                $callback($row);
                $lastId = $row['id'];
                $processed++;
            }

            gc_collect_cycles();

        } while (count($rows) === $this->batchSize);

        return $processed;
    }

    public function insertBatch(string $table, array $columns, array $rows): int {
        if (empty($rows)) {
            return 0;
        }

        $columnList = implode(', ', $columns);
        $placeholders = '(' . implode(', ', array_fill(0, count($columns), '?')) . ')';
        $allPlaceholders = implode(', ', array_fill(0, count($rows), $placeholders));

        $sql = "INSERT INTO {$table} ({$columnList}) VALUES {$allPlaceholders}";

        $values = [];
        foreach ($rows as $row) {
            foreach ($columns as $column) {
                $values[] = $row[$column] ?? null;
            }
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($values);

        return count($rows);
    }
}
```

### Caching Strategies

```php
<?php
class CacheManager {
    public function __construct(
        private readonly CacheInterface $cache,
        private readonly LoggerInterface $logger,
    ) {}

    // Read-through cache
    public function remember(string $key, int $ttl, callable $callback): mixed {
        if ($cached = $this->cache->get($key)) {
            return $cached;
        }

        $value = $callback();
        $this->cache->set($key, $value, $ttl);

        return $value;
    }

    // Cache with tags (for invalidation)
    public function rememberTagged(
        string $key,
        array $tags,
        int $ttl,
        callable $callback
    ): mixed {
        if ($cached = $this->cache->get($key)) {
            return $cached;
        }

        $value = $callback();
        $this->cache->set($key, $value, $ttl);

        foreach ($tags as $tag) {
            $tagKey = "tag:{$tag}";
            $taggedKeys = $this->cache->get($tagKey) ?? [];
            $taggedKeys[] = $key;
            $this->cache->set($tagKey, array_unique($taggedKeys), 86400);
        }

        return $value;
    }

    public function invalidateTag(string $tag): void {
        $tagKey = "tag:{$tag}";
        $keys = $this->cache->get($tagKey) ?? [];

        foreach ($keys as $key) {
            $this->cache->delete($key);
        }

        $this->cache->delete($tagKey);
        $this->logger->info("Cache tag invalidated", ['tag' => $tag, 'keys' => count($keys)]);
    }

    // Stampede protection
    public function rememberWithLock(
        string $key,
        int $ttl,
        callable $callback,
        int $lockTtl = 10
    ): mixed {
        if ($cached = $this->cache->get($key)) {
            return $cached;
        }

        $lockKey = "lock:{$key}";

        // Try to acquire lock
        if (!$this->cache->add($lockKey, 1, $lockTtl)) {
            // Wait and retry
            usleep(100000); // 100ms
            return $this->rememberWithLock($key, $ttl, $callback, $lockTtl);
        }

        try {
            $value = $callback();
            $this->cache->set($key, $value, $ttl);
            return $value;
        } finally {
            $this->cache->delete($lockKey);
        }
    }
}
```

---

## §5. CLI & Scripts

### Command Line Arguments

```php
<?php
// Basic argument handling
$script = $argv[0];
$args = array_slice($argv, 1);

// Using getopt
$options = getopt('v::h', ['verbose::', 'help', 'file:', 'dry-run']);

// $options structure:
// -v or --verbose => ['v' => false] or ['verbose' => false]
// -v=2 or --verbose=2 => ['v' => '2'] or ['verbose' => '2']
// --file=test.txt => ['file' => 'test.txt']
// --dry-run => ['dry-run' => false]

$verbose = isset($options['v']) || isset($options['verbose']);
$file = $options['file'] ?? null;
$dryRun = isset($options['dry-run']);

if (isset($options['h']) || isset($options['help'])) {
    echo "Usage: php script.php [options]\n";
    echo "  -v, --verbose    Enable verbose output\n";
    echo "  --file=FILE      Input file\n";
    echo "  --dry-run        Simulate without changes\n";
    exit(0);
}
```

### CLI Application Class

```php
<?php
abstract class CliCommand {
    protected string $name = 'command';
    protected string $description = '';

    abstract public function handle(array $args, array $options): int;

    public function output(string $message): void {
        echo $message . PHP_EOL;
    }

    public function info(string $message): void {
        echo "\033[32m{$message}\033[0m" . PHP_EOL;
    }

    public function error(string $message): void {
        echo "\033[31m{$message}\033[0m" . PHP_EOL;
    }

    public function warn(string $message): void {
        echo "\033[33m{$message}\033[0m" . PHP_EOL;
    }

    public function ask(string $question): string {
        echo $question . ' ';
        return trim(fgets(STDIN));
    }

    public function confirm(string $question, bool $default = false): bool {
        $suffix = $default ? '[Y/n]' : '[y/N]';
        $answer = strtolower($this->ask("{$question} {$suffix}"));

        if ($answer === '') {
            return $default;
        }

        return $answer === 'y' || $answer === 'yes';
    }

    public function progressBar(int $current, int $total, int $width = 50): void {
        $progress = (int) (($current / $total) * $width);
        $bar = str_repeat('=', $progress) . str_repeat(' ', $width - $progress);
        $percent = (int) (($current / $total) * 100);

        echo "\r[{$bar}] {$percent}% ({$current}/{$total})";

        if ($current === $total) {
            echo PHP_EOL;
        }
    }
}

class ProcessContactsCommand extends CliCommand {
    protected string $name = 'process:contacts';
    protected string $description = 'Process all contacts';

    public function __construct(
        private readonly ContactHandler $handler,
    ) {}

    public function handle(array $args, array $options): int {
        $dryRun = in_array('--dry-run', $args);
        $limit = $options['limit'] ?? null;

        $contacts = $this->handler->getAll();
        $total = count($contacts);

        $this->info("Processing {$total} contacts...");

        if ($dryRun) {
            $this->warn("Dry run mode - no changes will be made");
        }

        foreach ($contacts as $index => $contact) {
            $this->progressBar($index + 1, $total);

            if (!$dryRun) {
                $this->processContact($contact);
            }

            if ($limit && $index + 1 >= $limit) {
                break;
            }
        }

        $this->info("Done!");
        return 0;
    }

    private function processContact(array $contact): void {
        // Process logic
    }
}
```

### Signal Handling

```php
<?php
class LongRunningProcess {
    private bool $shouldStop = false;

    public function __construct() {
        // Register signal handlers
        pcntl_async_signals(true);

        pcntl_signal(SIGTERM, [$this, 'handleSignal']);
        pcntl_signal(SIGINT, [$this, 'handleSignal']);
    }

    public function handleSignal(int $signal): void {
        echo "\nReceived signal {$signal}, shutting down gracefully...\n";
        $this->shouldStop = true;
    }

    public function run(): void {
        echo "Starting process (PID: " . getmypid() . ")...\n";

        while (!$this->shouldStop) {
            // Do work
            $this->processNext();

            // Check for pending signals
            pcntl_signal_dispatch();
        }

        $this->cleanup();
        echo "Process stopped cleanly.\n";
    }

    protected function processNext(): void {
        // Process one item
        sleep(1);
    }

    protected function cleanup(): void {
        // Cleanup resources
    }
}
```

---

## §6. Debugging & Profiling

### Debugging Helpers

```php
<?php
class Debug {
    public static function dump(mixed ...$vars): void {
        foreach ($vars as $var) {
            echo '<pre>';
            var_dump($var);
            echo '</pre>';
        }
    }

    public static function dd(mixed ...$vars): never {
        self::dump(...$vars);
        exit(1);
    }

    public static function trace(): void {
        $trace = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS);
        foreach ($trace as $i => $step) {
            $file = $step['file'] ?? 'unknown';
            $line = $step['line'] ?? 0;
            $function = $step['function'] ?? 'unknown';
            $class = $step['class'] ?? '';
            $type = $step['type'] ?? '';

            echo "#{$i} {$file}:{$line} {$class}{$type}{$function}()\n";
        }
    }

    public static function memory(): string {
        $bytes = memory_get_usage(true);
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }

    public static function peakMemory(): string {
        $bytes = memory_get_peak_usage(true);
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($bytes >= 1024 && $i < count($units) - 1) {
            $bytes /= 1024;
            $i++;
        }
        return round($bytes, 2) . ' ' . $units[$i];
    }
}
```

### Profiler

```php
<?php
class Profiler {
    private static array $timers = [];
    private static array $memory = [];

    public static function start(string $name): void {
        self::$timers[$name] = [
            'start' => microtime(true),
            'memory_start' => memory_get_usage(),
        ];
    }

    public static function stop(string $name): array {
        if (!isset(self::$timers[$name])) {
            throw new RuntimeException("Timer '{$name}' not started");
        }

        $timer = self::$timers[$name];
        $duration = microtime(true) - $timer['start'];
        $memoryUsed = memory_get_usage() - $timer['memory_start'];

        unset(self::$timers[$name]);

        return [
            'name' => $name,
            'duration' => $duration,
            'duration_formatted' => self::formatDuration($duration),
            'memory' => $memoryUsed,
            'memory_formatted' => self::formatBytes($memoryUsed),
        ];
    }

    public static function measure(string $name, callable $callback): mixed {
        self::start($name);
        try {
            return $callback();
        } finally {
            $result = self::stop($name);
            error_log("[Profiler] {$result['name']}: {$result['duration_formatted']} ({$result['memory_formatted']})");
        }
    }

    private static function formatDuration(float $seconds): string {
        if ($seconds < 0.001) {
            return round($seconds * 1000000) . 'µs';
        }
        if ($seconds < 1) {
            return round($seconds * 1000, 2) . 'ms';
        }
        return round($seconds, 3) . 's';
    }

    private static function formatBytes(int $bytes): string {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        $value = abs($bytes);
        while ($value >= 1024 && $i < count($units) - 1) {
            $value /= 1024;
            $i++;
        }
        $sign = $bytes < 0 ? '-' : '+';
        return $sign . round($value, 2) . $units[$i];
    }
}

// Usage
$users = Profiler::measure('load_users', function() use ($handler) {
    return $handler->getAll();
});
```

---

## §7. HTTP Client Patterns

### Guzzle Wrapper

```php
<?php
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

class ApiClient {
    private Client $client;

    public function __construct(
        private readonly string $baseUrl,
        private readonly ?string $apiKey = null,
        private readonly int $timeout = 30,
    ) {
        $stack = HandlerStack::create();

        // Add retry middleware
        $stack->push(Middleware::retry(
            $this->retryDecider(),
            $this->retryDelay()
        ));

        // Add logging middleware
        $stack->push(Middleware::log(
            $this->getLogger(),
            new MessageFormatter('{method} {uri} - {code} {res_header_Content-Length}')
        ));

        $this->client = new Client([
            'base_uri' => $this->baseUrl,
            'timeout' => $this->timeout,
            'handler' => $stack,
            'headers' => $this->getDefaultHeaders(),
        ]);
    }

    public function get(string $path, array $query = []): array {
        try {
            $response = $this->client->get($path, ['query' => $query]);
            return $this->parseResponse($response);
        } catch (GuzzleException $e) {
            throw $this->handleException($e);
        }
    }

    public function post(string $path, array $data = []): array {
        try {
            $response = $this->client->post($path, ['json' => $data]);
            return $this->parseResponse($response);
        } catch (GuzzleException $e) {
            throw $this->handleException($e);
        }
    }

    public function put(string $path, array $data = []): array {
        try {
            $response = $this->client->put($path, ['json' => $data]);
            return $this->parseResponse($response);
        } catch (GuzzleException $e) {
            throw $this->handleException($e);
        }
    }

    public function delete(string $path): bool {
        try {
            $this->client->delete($path);
            return true;
        } catch (GuzzleException $e) {
            throw $this->handleException($e);
        }
    }

    private function getDefaultHeaders(): array {
        $headers = [
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ];

        if ($this->apiKey) {
            $headers['Authorization'] = "Bearer {$this->apiKey}";
        }

        return $headers;
    }

    private function parseResponse(ResponseInterface $response): array {
        $body = (string) $response->getBody();
        return json_decode($body, true) ?? [];
    }

    private function retryDecider(): callable {
        return function(
            int $retries,
            RequestInterface $request,
            ?ResponseInterface $response = null,
            ?Throwable $exception = null
        ): bool {
            if ($retries >= 3) {
                return false;
            }

            // Retry on server errors
            if ($response && $response->getStatusCode() >= 500) {
                return true;
            }

            // Retry on connection errors
            if ($exception instanceof ConnectException) {
                return true;
            }

            return false;
        };
    }

    private function retryDelay(): callable {
        return function(int $retries): int {
            return 1000 * pow(2, $retries); // Exponential backoff
        };
    }

    private function handleException(GuzzleException $e): ApiException {
        return new ApiException(
            message: "API request failed: {$e->getMessage()}",
            code: $e->getCode(),
            previous: $e,
        );
    }
}
```

---

## §8. File Handling

### File Operations

```php
<?php
class FileManager {
    public function read(string $path): string {
        if (!file_exists($path)) {
            throw new FileNotFoundException("File not found: {$path}");
        }

        $content = file_get_contents($path);
        if ($content === false) {
            throw new FileReadException("Failed to read file: {$path}");
        }

        return $content;
    }

    public function write(string $path, string $content): void {
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        if (file_put_contents($path, $content) === false) {
            throw new FileWriteException("Failed to write file: {$path}");
        }
    }

    public function append(string $path, string $content): void {
        if (file_put_contents($path, $content, FILE_APPEND) === false) {
            throw new FileWriteException("Failed to append to file: {$path}");
        }
    }

    public function copy(string $source, string $destination): void {
        $dir = dirname($destination);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        if (!copy($source, $destination)) {
            throw new FileOperationException("Failed to copy: {$source} -> {$destination}");
        }
    }

    public function move(string $source, string $destination): void {
        $dir = dirname($destination);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        if (!rename($source, $destination)) {
            throw new FileOperationException("Failed to move: {$source} -> {$destination}");
        }
    }

    public function delete(string $path): void {
        if (file_exists($path) && !unlink($path)) {
            throw new FileOperationException("Failed to delete: {$path}");
        }
    }

    public function readLines(string $path): Generator {
        $handle = fopen($path, 'r');
        if (!$handle) {
            throw new FileReadException("Failed to open file: {$path}");
        }

        try {
            while (($line = fgets($handle)) !== false) {
                yield trim($line);
            }
        } finally {
            fclose($handle);
        }
    }

    public function readCsv(string $path, string $delimiter = ','): Generator {
        $handle = fopen($path, 'r');
        if (!$handle) {
            throw new FileReadException("Failed to open file: {$path}");
        }

        try {
            $headers = fgetcsv($handle, 0, $delimiter);
            while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
                yield array_combine($headers, $row);
            }
        } finally {
            fclose($handle);
        }
    }
}
```

### File Upload Handling

```php
<?php
class UploadHandler {
    private array $allowedMimeTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'application/pdf',
    ];

    private int $maxSize = 10 * 1024 * 1024; // 10MB

    public function __construct(
        private readonly string $uploadDir,
    ) {}

    public function handle(array $file): string {
        $this->validate($file);

        $filename = $this->generateFilename($file);
        $destination = $this->uploadDir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new UploadException('Failed to move uploaded file');
        }

        return $filename;
    }

    private function validate(array $file): void {
        if ($file['error'] !== UPLOAD_ERR_OK) {
            throw new UploadException($this->getErrorMessage($file['error']));
        }

        if ($file['size'] > $this->maxSize) {
            throw new UploadException('File too large');
        }

        $mimeType = mime_content_type($file['tmp_name']);
        if (!in_array($mimeType, $this->allowedMimeTypes)) {
            throw new UploadException("Invalid file type: {$mimeType}");
        }
    }

    private function generateFilename(array $file): string {
        $extension = pathinfo($file['name'], PATHINFO_EXTENSION);
        return bin2hex(random_bytes(16)) . '.' . $extension;
    }

    private function getErrorMessage(int $error): string {
        return match($error) {
            UPLOAD_ERR_INI_SIZE => 'File exceeds upload_max_filesize',
            UPLOAD_ERR_FORM_SIZE => 'File exceeds MAX_FILE_SIZE',
            UPLOAD_ERR_PARTIAL => 'File was only partially uploaded',
            UPLOAD_ERR_NO_FILE => 'No file was uploaded',
            UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
            UPLOAD_ERR_CANT_WRITE => 'Failed to write to disk',
            UPLOAD_ERR_EXTENSION => 'Upload stopped by extension',
            default => 'Unknown upload error',
        };
    }
}
```

---

## Quick Reference

### Common Composer Commands

```bash
composer install           # Install dependencies
composer update            # Update dependencies
composer require pkg       # Add package
composer remove pkg        # Remove package
composer dump-autoload     # Regenerate autoloader
composer outdated          # Show outdated packages
```

### PHP CLI Commands

```bash
php -v                     # Version
php -m                     # Loaded modules
php -i                     # phpinfo()
php -l file.php            # Syntax check
php -r 'echo "test";'      # Run code
php -S localhost:8000      # Built-in server
```

### PHPUnit Commands

```bash
./vendor/bin/phpunit                    # Run all tests
./vendor/bin/phpunit --filter=testName  # Run specific test
./vendor/bin/phpunit --coverage-html=cov # Coverage report
./vendor/bin/phpunit --group=unit       # Run group
```

---

**For quick patterns and code snippets, see SKILL.md**
