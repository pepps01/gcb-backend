import { Router } from 'express';
import { asyncHandler } from '../../utils/async';

const router = Router();

router.get(
    '/current',
    asyncHandler(async (req, res) => {
        const t = req.tenant!;
        res.json({
            id: t.id,
            slug: t.slug,
            name: t.name,
            plan: t.plan,
            default_language: t.default_language,
            branding: t.branding,
            features: t.features,
        });
    })
);

export default router;