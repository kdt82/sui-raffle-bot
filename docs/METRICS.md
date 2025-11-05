# Metrics Collection

This bot exposes Prometheus-compatible metrics at `/metrics` endpoint.

## Available Metrics

### Command Metrics
- `bot_commands_total` - Total commands executed (labeled by command, user_type)

### Buy Events
- `buy_events_total` - Buy events processed (labeled by dex, status)
- `tickets_allocated_total` - Total tickets allocated

### Raffle Metrics
- `active_raffles` - Number of active raffles
- `active_conversations` - Active admin conversations

### Performance Metrics
- `db_query_duration_seconds` - Database query duration
- `redis_operation_duration_seconds` - Redis operation duration
- `telegram_api_duration_seconds` - Telegram API call duration

### Job Queue Metrics
- `jobs_processed_total` - Jobs processed (labeled by queue, status)
- `active_jobs` - Currently active jobs

### System Metrics
- `process_cpu_user_seconds_total` - CPU usage
- `process_resident_memory_bytes` - Memory usage
- `nodejs_heap_size_used_bytes` - Heap usage
- And many more from `prom-client` defaults

## Accessing Metrics

```bash
# View metrics
curl http://localhost:3000/metrics

# Prometheus scrape config
scrape_configs:
  - job_name: 'raffle-bot'
    static_configs:
      - targets: ['localhost:3000']
```

## Grafana Dashboard

Import the provided dashboard JSON or create custom dashboards using these metrics.

### Key Queries

```promql
# Command rate per minute
rate(bot_commands_total[1m])

# Success rate of buy events
rate(buy_events_total{status="success"}[5m])

# Average database query time
rate(db_query_duration_seconds_sum[1m]) / rate(db_query_duration_seconds_count[1m])

# Error rate
rate(errors_total[5m])

# Active raffles over time
active_raffles
```

## Alerting Examples

```yaml
groups:
  - name: raffle_bot
    rules:
      - alert: HighErrorRate
        expr: rate(errors_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate detected"
      
      - alert: NoActiveRaffles
        expr: active_raffles == 0
        for: 30m
        annotations:
          summary: "No active raffles for 30 minutes"
      
      - alert: SlowDatabaseQueries
        expr: db_query_duration_seconds{quantile="0.99"} > 1
        for: 5m
        annotations:
          summary: "Database queries are slow"
```

