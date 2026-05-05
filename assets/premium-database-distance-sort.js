const SoftoraDatabaseDistanceSort = (() => {
    const center = { lat: 51.5792, lng: 5.1889 };
    const placeCoords = {
        oisterwijk: { lat: 51.5792, lng: 5.1889 },
        moergestel: { lat: 51.5444, lng: 5.1847 },
        haaren: { lat: 51.6027, lng: 5.2222 },
        'berkel enschot': { lat: 51.5886, lng: 5.1428 },
        tilburg: { lat: 51.5555, lng: 5.0913 },
        udenhout: { lat: 51.6098, lng: 5.1436 },
        biezenmortel: { lat: 51.6232, lng: 5.1775 },
        boxtel: { lat: 51.5908, lng: 5.3293 },
        vught: { lat: 51.6533, lng: 5.2875 },
        'den bosch': { lat: 51.6978, lng: 5.3037 },
        's hertogenbosch': { lat: 51.6978, lng: 5.3037 },
        goirle: { lat: 51.5206, lng: 5.0667 },
        riel: { lat: 51.5221, lng: 5.0219 },
        hilvarenbeek: { lat: 51.4858, lng: 5.1397 },
        'biest houtakker': { lat: 51.5059, lng: 5.1589 },
        oirschot: { lat: 51.505, lng: 5.3139 },
        best: { lat: 51.5075, lng: 5.3903 },
        waalwijk: { lat: 51.6828, lng: 5.0707 },
        'loon op zand': { lat: 51.6276, lng: 5.0757 },
        kaatsheuvel: { lat: 51.6554, lng: 5.0463 },
        dongen: { lat: 51.6265, lng: 4.9383 },
        rijen: { lat: 51.5906, lng: 4.9197 },
        gilze: { lat: 51.5449, lng: 4.9402 },
        alphen: { lat: 51.4818, lng: 4.9583 },
        almkerk: { lat: 51.7707, lng: 4.9598 },
        andel: { lat: 51.7835, lng: 5.0585 },
        chaam: { lat: 51.5067, lng: 4.8619 },
        'baarle nassau': { lat: 51.4476, lng: 4.9292 },
        ulvenhout: { lat: 51.5496, lng: 4.7989 },
        galder: { lat: 51.5156, lng: 4.7752 },
        strijbeek: { lat: 51.5004, lng: 4.7946 },
        bavel: { lat: 51.5642, lng: 4.8303 },
        breda: { lat: 51.5719, lng: 4.7683 },
        oosterhout: { lat: 51.645, lng: 4.8597 },
        'etten leur': { lat: 51.5706, lng: 4.6373 },
        eindhoven: { lat: 51.4416, lng: 5.4697 },
        veldhoven: { lat: 51.418, lng: 5.4024 },
        waalre: { lat: 51.3867, lng: 5.4447 },
        valkenswaard: { lat: 51.3513, lng: 5.4595 },
        helmond: { lat: 51.4793, lng: 5.657 },
        oss: { lat: 51.765, lng: 5.5181 },
        uden: { lat: 51.6608, lng: 5.6194 },
        veghel: { lat: 51.6167, lng: 5.5486 },
        schijndel: { lat: 51.6225, lng: 5.4319 },
        'sint oedenrode': { lat: 51.5675, lng: 5.4597 },
    };
    const postcodeCoords = {
        4286: placeCoords.almkerk,
        4851: placeCoords.ulvenhout,
        4855: placeCoords.galder,
        4856: placeCoords.strijbeek,
        4858: placeCoords.ulvenhout,
        4859: placeCoords.bavel,
        4861: placeCoords.chaam,
        5051: placeCoords.goirle,
        5061: placeCoords.oisterwijk,
        5062: placeCoords.oisterwijk,
        5066: placeCoords.moergestel,
        5071: placeCoords.udenhout,
        5074: placeCoords.biezenmortel,
        5081: placeCoords.hilvarenbeek,
        5084: placeCoords['biest houtakker'],
        5121: placeCoords.rijen,
        5126: placeCoords.gilze,
        5131: placeCoords.alphen,
        4281: placeCoords.andel,
    };

    function normalizeText(value) {
        return String(value || '').trim();
    }

    function normalizePlaceKey(value) {
        return normalizeText(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['’]/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function haversineDistanceKm(left, right) {
        const toRad = (value) => (Number(value) * Math.PI) / 180;
        const dLat = toRad(right.lat - left.lat);
        const dLng = toRad(right.lng - left.lng);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(left.lat)) * Math.cos(toRad(right.lat)) *
            Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function resolveCustomerDistanceCoords(customer) {
        const explicitLat = Number(customer && (customer.lat || customer.latitude || customer.latitudeNumber));
        const explicitLng = Number(customer && (customer.lng || customer.lon || customer.longitude || customer.longitudeNumber));
        if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng)) return { lat: explicitLat, lng: explicitLng };
        const addressText = [customer && customer.stad, customer && customer.adres, customer && customer.address, customer && customer.plaats, customer && customer.location]
            .filter(Boolean)
            .join(' ');
        const postcodeMatch = normalizeText(addressText).toUpperCase().match(/\b([1-9][0-9]{3})\s?[A-Z]{2}\b/);
        if (postcodeMatch && postcodeCoords[postcodeMatch[1]]) return postcodeCoords[postcodeMatch[1]];
        const haystack = normalizePlaceKey(addressText);
        const placeKey = Object.keys(placeCoords)
            .sort((left, right) => right.length - left.length)
            .find((key) => haystack.indexOf(normalizePlaceKey(key)) !== -1);
        return placeKey ? placeCoords[placeKey] : null;
    }

    function getCustomerDistanceKm(customer) {
        const existing = Number(customer && (customer.distanceKm || customer.afstandKm || customer.radiusKm));
        if (Number.isFinite(existing) && existing >= 0) return existing;
        const coords = resolveCustomerDistanceCoords(customer);
        return coords ? haversineDistanceKm(center, coords) : Number.POSITIVE_INFINITY;
    }

    function compareCustomersByDistance(leftCustomer, rightCustomer) {
        const leftDistance = getCustomerDistanceKm(leftCustomer);
        const rightDistance = getCustomerDistanceKm(rightCustomer);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        const leftName = normalizePlaceKey(leftCustomer && leftCustomer.bedrijf);
        const rightName = normalizePlaceKey(rightCustomer && rightCustomer.bedrijf);
        if (leftName < rightName) return -1;
        if (leftName > rightName) return 1;
        return 0;
    }

    return {
        sortCustomersByDistance(list) {
            return Array.isArray(list) ? list.slice().sort(compareCustomersByDistance) : [];
        },
        compareCustomersByDistance,
        getCustomerDistanceKm,
        resolveCustomerDistanceCoords,
        center,
    };
})();

window.SoftoraDatabaseDistanceSort = SoftoraDatabaseDistanceSort;
