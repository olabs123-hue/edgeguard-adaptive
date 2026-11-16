#include "router.hpp"
#include <chrono>
#include <iostream>
int main() {
  using namespace edgeguard;
  const auto now = std::chrono::steady_clock::now();
  AdaptiveRouter router({"origin-a", "origin-b"});
  auto selected = router.acquire(now);
  if (!selected) return 1;
  router.complete(*selected, true, 12.0, now);
  std::cout << "Selected " << router.backend(*selected).address
            << " (circuit " << circuit_name(router.backend(*selected).state) << ")\n";
}
