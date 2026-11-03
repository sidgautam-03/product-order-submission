import { Link } from 'react-router-dom'
import StarRating from '../../components/StarRating'
import { money } from '../../utils/format'

export default function ProductCard({ product }) {
  const image = product.images[0]?.url
  return (
    <article className="card product-card">
      <Link to={`/products/${product.id}`}>
        {image ? <img src={image} alt={product.name} loading="lazy" /> : <div className="no-image">No image</div>}
        <h3>{product.name}</h3>
      </Link>
      <p className="price">{money(product.price)}</p>
      <p className="muted">{product.category}</p>
      <p>
        <StarRating value={product.rating} /> <span className="muted">({product.reviewCount})</span>
      </p>
    </article>
  )
}
