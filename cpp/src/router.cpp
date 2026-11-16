#include "router.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <unordered_set>
#include <utility>

namespace edgeguard {
AdaptiveRouter::AdaptiveRouter(std::vector<std::string> addresses, Policy policy)
    : policy_(policy) {
  if (addresses.empty() || policy_.window_size == 0 || policy_.min_samples == 0 ||
      policy_.min_samples > policy_.window_size ||
      !std::isfinite(policy_.failure_threshold) ||
      policy_.failure_threshold <= 0 || policy_.failure_threshold > 1 ||
      policy_.half_open_limit == 0 || !std::isfinite(policy_.latency_weight) ||
      policy_.latency_weight < 0 || policy_.open_interval.count() <= 0)
    throw std::invalid_argument("invalid router configuration");
  std::unordered_set<std::string> seen;
  for (auto& addr : addresses) {
    if (addr.empty() || !seen.insert(addr).second)
      throw std::invalid_argument("empty or duplicate backend");
    Backend b;
    b.address = std::move(addr);
    backends_.push_back(std::move(b));
  }
}

std::optional<std::size_t> AdaptiveRouter::acquire(std::chrono::steady_clock::time_point now) {
  std::optional<std::size_t> selected;
  double best_score = -1;
  for (std::size_t offset = 0; offset < backends_.size(); ++offset) {
    auto i = (cursor_ + offset) % backends_.size();
    auto& b = backends_[i];
    if (b.state == Circuit::Open && now - b.opened_at >= policy_.open_interval) {
      b.state = Circuit::HalfOpen;
      b.in_flight_probes = 0;
    }
    if (b.state == Circuit::Open ||
        (b.state == Circuit::HalfOpen && b.in_flight_probes >= policy_.half_open_limit))
      continue;
    const auto errors = std::count(b.outcomes.begin(), b.outcomes.end(), false);
    const double error_rate = b.outcomes.empty() ? 0 : double(errors) / b.outcomes.size();
    const double score = 1.0 / (1 + 4 * error_rate +
                                policy_.latency_weight * (b.has_latency ? b.ewma_ms : 0));
    if (score > best_score) { selected = i; best_score = score; }
  }
  if (selected) {
    cursor_ = (*selected + 1) % backends_.size();
    if (backends_[*selected].state == Circuit::HalfOpen)
      ++backends_[*selected].in_flight_probes;
  }
  return selected;
}

void AdaptiveRouter::complete(std::size_t i, bool ok, double latency_ms,
                              std::chrono::steady_clock::time_point now) {
  if (i >= backends_.size()) throw std::out_of_range("backend index");
  if (!std::isfinite(latency_ms) || latency_ms < 0)
    throw std::invalid_argument("invalid request latency");
  auto& b = backends_[i];
  if (b.state == Circuit::HalfOpen) {
    if (b.in_flight_probes == 0) throw std::logic_error("probe completion without lease");
    --b.in_flight_probes;
  }
  if (ok) ++b.successes; else ++b.failures;
  b.ewma_ms = b.has_latency ? 0.3 * latency_ms + 0.7 * b.ewma_ms : latency_ms;
  b.has_latency = true;
  b.outcomes.push_back(ok);
  if (b.outcomes.size() > policy_.window_size) b.outcomes.pop_front();
  if (b.state == Circuit::HalfOpen) {
    if (!ok) { b.state = Circuit::Open; b.opened_at = now; }
    else if (b.in_flight_probes == 0) { b.state = Circuit::Closed; b.outcomes.clear(); }
    return;
  }
  const auto errors = std::count(b.outcomes.begin(), b.outcomes.end(), false);
  if (b.state == Circuit::Closed && b.outcomes.size() >= policy_.min_samples &&
      double(errors) / b.outcomes.size() >= policy_.failure_threshold) {
    b.state = Circuit::Open;
    b.opened_at = now;
  }
}

const Backend& AdaptiveRouter::backend(std::size_t i) const { return backends_.at(i); }
const char* circuit_name(Circuit c) {
  switch (c) {
    case Circuit::Closed: return "closed";
    case Circuit::Open: return "open";
    case Circuit::HalfOpen: return "half-open";
  }
  return "unknown";
}
} // namespace edgeguard
