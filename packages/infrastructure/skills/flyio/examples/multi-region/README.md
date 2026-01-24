# Multi-Region Deployment - Fly.io

Deploy your application across multiple global regions for low latency worldwide.

## Features
- ✅ Automatic geographic routing to nearest region
- ✅ Multi-region deployment in one command
- ✅ Regional scaling configuration
- ✅ Cross-region request replay
- ✅ Region-aware health checks

## Quick Start

### 1. Deploy to Primary Region

```bash
flyctl apps create multi-region-app
flyctl deploy --remote-only
```

### 2. Add Regions

```bash
# Add regions
flyctl regions add iad ams fra nrt syd

# View available regions
flyctl platform regions
```

### 3. Scale Per Region

```bash
# Scale specific region
flyctl scale count 2 --region sea
flyctl scale count 2 --region iad
flyctl scale count 1 --region ams

# View current distribution
flyctl status
```

## Available Regions

### Americas
- `sea` - Seattle, Washington (US West)
- `sjc` - San Jose, California (US West)
- `lax` - Los Angeles, California (US West)
- `iad` - Ashburn, Virginia (US East)
- `ord` - Chicago, Illinois (US Central)
- `dfw` - Dallas, Texas (US Central)
- `mia` - Miami, Florida (US East)
- `yyz` - Toronto, Canada
- `gru` - São Paulo, Brazil
- `scl` - Santiago, Chile

### Europe
- `ams` - Amsterdam, Netherlands
- `fra` - Frankfurt, Germany
- `lhr` - London, United Kingdom
- `cdg` - Paris, France
- `mad` - Madrid, Spain
- `arn` - Stockholm, Sweden

### Asia Pacific
- `nrt` - Tokyo, Japan
- `hkg` - Hong Kong
- `sin` - Singapore
- `syd` - Sydney, Australia

## Routing

Fly.io automatically routes requests to the nearest region based on:
1. **Geographic proximity** - Closest region to user
2. **Health checks** - Only healthy machines
3. **Capacity** - Available resources

## Region Headers

Your application receives these headers:

```javascript
// Current region serving the request
const region = req.get('fly-region');

// User's nearest region
const clientRegion = req.get('fly-client-region');

// Request was replayed from another region
const replay = req.get('fly-replay');
```

## Cross-Region Database

### Option 1: Read Replicas

```bash
# Create primary database
flyctl postgres create --name myapp-db --region sea

# Create read replicas
flyctl postgres create --name myapp-db-replica-ams --region ams
flyctl postgres create --name myapp-db-replica-nrt --region nrt
```

### Option 2: LiteFS (Distributed SQLite)

```toml
# fly.toml
[mounts]
  source = "litefs"
  destination = "/var/lib/litefs"

[experimental]
  enable_litefs = true
```

### Option 3: Global Database (Planetscale, Supabase)

Use a globally distributed database service.

## Request Replay

Replay requests to another region:

```javascript
app.get('/api/data/:id', async (req, res) => {
  // If data is in different region, replay request there
  const dataRegion = await getDataRegion(req.params.id);

  if (dataRegion !== process.env.FLY_REGION) {
    res.set('fly-replay', `region=${dataRegion}`);
    return res.status(409).end();
  }

  // Serve data from current region
  const data = await getData(req.params.id);
  res.json(data);
});
```

## Cost Optimization

### Regional Pricing

Different regions have different pricing. Optimize costs:

```bash
# Check pricing
flyctl platform regions

# Use cheaper regions when possible
flyctl scale count 3 --region sea  # US regions often cheaper
flyctl scale count 1 --region ams  # Keep minimum in expensive regions
```

### Scale to Zero in Low-Traffic Regions

```toml
[http_service]
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0  # Per region
```

## Monitoring

### View Regional Status

```bash
# Overall status
flyctl status

# Regional distribution
flyctl regions list

# Region-specific metrics
flyctl metrics --region sea
```

### Logs by Region

```bash
# All regions
flyctl logs

# Specific region
flyctl logs --region sea

# Multiple regions
flyctl logs --region sea,iad,ams
```

## Scaling Strategies

### Strategy 1: Uniform Distribution

Equal machines in all regions:

```bash
flyctl scale count 2 --region sea,iad,ams,nrt
```

### Strategy 2: Weighted by Traffic

More machines in high-traffic regions:

```bash
flyctl scale count 3 --region sea  # High traffic
flyctl scale count 3 --region iad  # High traffic
flyctl scale count 1 --region ams  # Medium traffic
flyctl scale count 1 --region nrt  # Low traffic
```

### Strategy 3: Follow the Sun

Scale based on time zones:

```bash
# Morning in Asia - scale up NRT, HKG
# Afternoon in Europe - scale up AMS, FRA
# Evening in Americas - scale up SEA, IAD
```

## Troubleshooting

### High latency in specific region

```bash
# Check health in region
flyctl checks list --region ams

# View logs for region
flyctl logs --region ams

# SSH into machine in region
flyctl ssh console --region ams
```

### Uneven traffic distribution

```bash
# Check DNS resolution
dig multi-region-app.fly.dev

# Force region with header
curl -H "fly-prefer-region: sea" https://multi-region-app.fly.dev
```

### Database connection issues

```bash
# Check database region
flyctl postgres db list

# Consider read replicas or global database
```

## Production Checklist

- [ ] Deploy to primary region first
- [ ] Test application works correctly
- [ ] Add secondary regions progressively
- [ ] Configure database replication strategy
- [ ] Set up region-aware monitoring
- [ ] Test request replay (if needed)
- [ ] Configure regional autoscaling
- [ ] Set up alerts for regional failures
- [ ] Document regional routing strategy
- [ ] Test failover scenarios

## Resources
- [Fly.io Regions](https://fly.io/docs/reference/regions/)
- [Multi-Region Apps](https://fly.io/docs/blueprints/multi-region-databases/)
- [Request Replay](https://fly.io/docs/reference/dynamic-request-routing/)
