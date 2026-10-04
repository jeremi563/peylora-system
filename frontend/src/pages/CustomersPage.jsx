import { useEffect, useState } from "react";
import { Building2, Search, Users } from "lucide-react";

import { apiRequest } from "../api.js";
import {
  EmptyState,
  ErrorNotice,
  ErrorState,
  PageHeading,
  SkeletonTable,
  formatDate,
  formatKes
} from "../components/ui.jsx";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const result = await apiRequest("/api/invoices?limit=200");
        const map = new Map();
        for (const invoice of result.invoices || []) {
          const name = invoice.customer_name || "Unidentified customer";
          const phone = invoice.customer_phone || "—";
          const current = map.get(phone || name) || {
            name,
            phone,
            email: invoice.customer?.email || "—",
            lastInvoice: invoice.created_at,
            total: 0,
            purchases: 0
          };
          current.total += Number(invoice.total_amount || 0);
          current.purchases += 1;
          current.lastInvoice = invoice.created_at;
          current.email = invoice.customer?.email || current.email;
          map.set(phone || name, current);
        }
        setCustomers(Array.from(map.values()).filter((customer) =>
          customer.name.toLowerCase().includes(search.toLowerCase()) || customer.phone.toLowerCase().includes(search.toLowerCase())
        ));
        setError("");
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [search]);

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="RELATIONSHIP MANAGEMENT"
        title="Customers"
        description="Review the customers recorded through your merchant invoices and payment flows."
      />
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <section className="surface table-surface">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer or phone number"
            />
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={5} cols={5} />
        ) : error && !customers.length ? (
          <ErrorState message={error} onRetry={() => setSearch(search)} />
        ) : customers.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Invoices</th>
                  <th>Revenue</th>
                  <th>Last payment</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={`${customer.name}-${customer.phone}`}>
                    <td>
                      <span className="table-primary">{customer.name}</span>
                      <small className="table-secondary">{customer.email || "No email on record"}</small>
                    </td>
                    <td>{customer.phone}</td>
                    <td>{customer.purchases}</td>
                    <td className="amount-cell">{formatKes(customer.total)}</td>
                    <td>{formatDate(customer.lastInvoice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No customer records available"
            description="The current backend does not expose a dedicated customer API yet, so merchant customer records are shown only where invoice data exists."
            icon={<Building2 size={16} />}
          />
        )}
      </section>
    </div>
  );
}
